/*!
 * InkML.js
 * Load InkML into a JavaScript object and then render the object into a canvas.
 * Capture mouse/pen/touch strokes on a canvas and save the results to InkML.
 * Tom Underhill <tomun@microsoft.com>
 */

// dpi for converting ink space (himetric) to pixels
var g_dpi = 150;

// xml namespaces
var c_inkmlNS = "http://www.w3.org/2003/InkML";
var c_xmlNS =   "http://www.w3.org/XML/1998/namespace";
var c_xmlnsNS = "http://www.w3.org/2000/xmlns/";

$(document).ready(function ()
{
	var doc = $(this).get(0);
	$(this).find("canvas").each(function ()
	{
		var canvas = $(this);

		var src = canvas.attr("data-inkml-src");
		if (src)
		{
			$.get(src, {}, function (xml, textStatus, jqXHR)
			{
				var ignorePressure = canvas.attr("data-inkml-ignorePressure");

				var ink = new Ink(xml);
				ink.draw(canvas.get(0), ignorePressure);
			});
		}

		var trg = canvas.attr("data-inkml-trg");
		if (trg)
		{
			var ink = new Ink();
			ink.initForCapture(canvas.get(0));
		}
	});
});

// Ink class
Ink = function (inkml)
{
	this.init(inkml);
}
$.extend(Ink.prototype,
{
	// init this object by deserializing InkML 
	init: function (inkml)
	{
		// members
		this.contexts = {};
		this.brushes = {};
		this.traces = [];
		this.mins = [];
		this.maxs = [];
		this.sums = [];
		this.count = 0;

		this.deltas = [];
		this.ctx = null;

		if (inkml == null)
			return;

		var This = this;

		// iterate over the contexts
		$(inkml).find("inkml\\:context, context").each(function ()
		{
			var id = $(this).attr("xml:id");
			if (id == null)
				id = $(this).attr("id"); // "xml:id" fails on opera, "id" works but fails on all other browsers
			if (id == null)
			{
				// InkML files may contain inkml:context and msink:context elements, but WebKit and Opera do
				// not distiguish between xml namespaces, so if the required xml:id attribute isn't present,
				// just assume its an msink:context and skip it.
			}
			else
				id = "#" + id;
			if (id)
			{
				var context = new InkContext($(this));
				This.contexts[id] = context;
			}
		});

		// iterate over the brushes
		$(inkml).find("inkml\\:brush, brush").each(function ()
		{
			var brush = new InkBrush($(this));
			var id = $(this).attr("xml:id");
			if (id == null)
				id = $(this).attr("id"); // "xml:id" fails on opera, "id" works but fails on all other browsers
			if (id == null)
				alert("error: brush requires id");
			else
				id = "#" + id;
			This.brushes[id] = brush;
		});

		// iterate over the traces
		$(inkml).find("inkml\\:trace, trace").each(function ()
		{
			var trace = new InkTrace(This, $(this));
			var id = $(this).attr("xml:id");
			if (id == null)
				id = $(this).attr("id"); // "xml:id" fails on opera, "id" works but fails on all other browsers
			if (id == null)
				id = This.traces.length;
			else
				id = "#" + id;
			This.traces[id] = trace;
		}); // next trace
	},

	toInkML: function ()
	{
		var inkml = document.implementation.createDocument(c_inkmlNS, "inkml:ink", null);

		//			Root with xmlns:xml			Root without xmlns:xml
		// IE9		children have xmlns:xml		children have xmlns:xml
		// FF:		children clean				children clean
		// Chrome:	children clean				children have xmlns:xml
		// Opera:	children clean				children clean
		var xmlns = inkml.createAttributeNS(c_xmlnsNS, "xmlns:xml");
		xmlns.nodeValue = c_xmlNS;
		inkml.documentElement.setAttributeNode(xmlns);

		var definitions = inkml.createElementNS(c_inkmlNS, "inkml:definitions");
		inkml.documentElement.appendChild(definitions);

		$.each(this.contexts, function (id, context)
		{
			var inkmlContext = context.toInkML(inkml);

			var xmlid = inkml.createAttributeNS(c_xmlNS, "xml:id");
			xmlid.nodeValue = id.substr(1); // strip leading '#'

			inkmlContext.setAttributeNode(xmlid);
			definitions.appendChild(inkmlContext);
		});

		$.each(this.brushes, function (id, brush)
		{
			var inkmlBrush = brush.toInkML(inkml);

			var xmlid = inkml.createAttributeNS(c_xmlNS, "xml:id");
			xmlid.nodeValue = id.substr(1); // strip leading '#'

			inkmlBrush.setAttributeNode(xmlid);
			definitions.appendChild(inkmlBrush);
		});

		// TODO: handle traceGroups
		$.each(this.traces, function (id, trace)
		{
			var inkmlTrace = trace.toInkML(inkml);

			if (typeof (id) != 'number')
			{
				var xmlid = inkml.createAttributeNS(c_xmlNS, "xml:id");
				xmlid.nodeValue = id.substr(1); // strip leading '#'

				inkmlTrace.setAttributeNode(xmlid);
			}
			inkml.documentElement.appendChild(inkmlTrace);
		});

		return inkml;
	},

	draw: function (canvas, ignorePressure)
	{
		var This = this;

		if (canvas.getContext == null)
		{
			alert("error: couldn't get context on canvas");
			return;
		}
		var ctx = canvas.getContext('2d');
		// draw the traces
		$.each(this.traces, function (id, trace)
		{
			ctx.save();

			// TODO: handle traceRef versus contextRef
			var context = This.contexts[trace.contextRef];

			ctx.scale(context.xFactor, context.xFactor);

			var brush = null;
			if (trace.brushRef != null)
			{
				brush = This.brushes[trace.brushRef];
				if (brush == null)
					alert("error: brush with xml:id='" + trace.brushRef + "' not found.");
			}
			if (brush != null)
			{
				// TODO: alpha
				// TODO: approximate rasterOps
				ctx.strokeStyle = brush.color;
				// TODO: approximate ink rectangluar brushes
				ctx.lineCap = "round";
				ctx.lineJoin = "round";

				var pixelWidth = HiMetricToPixel(brush.width, g_dpi);
				ctx.lineWidth = pixelWidth * 10;
			}

			ctx.beginPath();
			for (var i = 0; i < trace.table.length; i++)
			{
				if (i == 0)
				{
					if (ignorePressure)
					{
						var x = trace.table[i][0] - This.mins[0];
						var y = trace.table[i][1] - This.mins[1];
						ctx.moveTo(x, y);
					}
					else
					{
						// nop on first point
					}
					// TODO: handle traces with only a single point.
				}
				else
				{
					if (ignorePressure)
					{
						var x = trace.table[i][0] - This.mins[0];
						var y = trace.table[i][1] - This.mins[1];
						ctx.lineTo(x, y);
					}
					else
					{
						var x1 = trace.table[i - 1][0] - This.mins[0];
						var y1 = trace.table[i - 1][1] - This.mins[1];
						var x2 = trace.table[i][0] - This.mins[0];
						var y2 = trace.table[i][1] - This.mins[1];
						if (brush)
						{
							// TODO: use named channels instead of assuming index 2 is force
							var width = brush.width; // in himetric
							var force = (trace.table[i - 1][2] + trace.table[i][2]) / 2;
							if (force)
							{
								var avg = This.sums[2] / This.count;
								force -= context.fNeutral;
								force *= context.fFactor;
								width += (width * force);
							}
							var pixelWidth = HiMetricToPixel(width, g_dpi);
							ctx.lineWidth = pixelWidth * 10;
						}
						ctx.moveTo(x1, y1);
						ctx.lineTo(x2, y2);
						ctx.stroke();
					}
				}
			}
			if (ignorePressure)
				ctx.stroke();
			ctx.restore();
		});
	},

	initForCapture: function (canvas)
	{
		var This = this;
		$(canvas).bind("mousedown", function (event) { This.onMouseDown(event); });
		$(canvas).bind("mousemove", function (event) { This.onMouseMove(event); });
		$(canvas).bind("mouseup", function (event) { This.onMouseUp(event); });
	},

	pushCoord: function (event)
	{
		// TODO: incomplete

		/*
		var i = this.table.length;
		var x = event.offsetX;
		var y = event.offsetY;

		if (i == 0)
		{
		// absolute
		}
		if (i == 1)
		{
		// first derivative
		deltas.push(table[i][j]);
		table[i][j] = table[i - 1][j] + deltas[j];
		}
		else if (i > 1)
		{
		// second derivative
		deltas[j] += table[i][j];
		table[i][j] = table[i - 1][j] + deltas[j];
		}

		table.push([]);
		table[table.length - 1].push(x);
		table[table.length - 1].push(y);
		*/
	},

	onMouseDown: function (event)
	{
		var canvas = event.target;
		if ($.browser.msie)
			canvas.setCapture();

		this.ctx = canvas.getContext('2d');

		this.ctx.beginPath();
		this.ctx.strokeStyle = "#00FF00";
		this.ctx.lineWidth = 2;

		// fix for FireFix which doesn't have offsetX, offsetY
		if (!event.offsetX)
			event.offsetX = event.layerX - $(event.target).position().left;
		if (!event.offsetY)
			event.offsetY = event.layerY - $(event.target).position().top;

		this.ctx.moveTo(event.offsetX, event.offsetY);
		this.pushCoord(event);
	},

	onMouseMove: function (event)
	{
		if (this.ctx)
		{
			// fix for FireFix which doesn't have offsetX, offsetY
			if (!event.offsetX)
				event.offsetX = event.layerX - $(event.target).position().left;
			if (!event.offsetY)
				event.offsetY = event.layerY - $(event.target).position().top;

			this.ctx.lineTo(event.offsetX, event.offsetY);
			this.ctx.stroke();
			this.pushCoord(event);
		}
	},

	onMouseUp: function (event)
	{
		if (this.ctx)
		{
			// working in all but FireFox: in FF, event is reached, but nothing is drawn.  Wrong ctx?
			var canvas = event.target;
			if ($.browser.msie)
				canvas.releaseCapture();

			// fix for FireFix which doesn't have offsetX, offsetY
			if (!event.offsetX)
				event.offsetX = event.layerX - $(event.target).position().left;
			if (!event.offsetY)
				event.offsetY = event.layerY - $(event.target).position().top;

			this.ctx.lineTo(event.offsetX, event.offsetY);
			this.ctx.stroke();
			this.pushCoord(event);

			this.ctx = null;
		}
	}
});

// InkContext class
InkContext = function (inkmlContext)
{
	this.init(inkmlContext);
}
$.extend(InkContext.prototype,
{
	// init this object by deserializing an InkML context
	init: function (inkmlContext)
	{
		// members
		this.inkSource = null;
		this.xFactor = 1;
		this.yFactor = 1;
		this.fFactor = 1;
		this.fNeutral = .5;

		var This = this;

		// find the optional inkSource
		// TODO: handle inkSourceRef
		var inkmlInkSource = $(inkmlContext).find("inkml\\:inkSource, inkSource");
		if (inkmlInkSource.length)
		{
			This.inkSource = new InkSource(inkmlInkSource);

			// compute and cache Ink to SVG scaling factors
			// TODO: defaults for missing explicit X and Y channels
			var xChan = This.inkSource.traceFormat.channels["X"];
			var yChan = This.inkSource.traceFormat.channels["Y"];

			var xRes = UnitsToHiMetric(1 / xChan.resolution, xChan.units);
			var yRes = UnitsToHiMetric(1 / yChan.resolution, yChan.units);
			This.xFactor = HiMetricToPixel(xRes, g_dpi);
			This.yFactor = HiMetricToPixel(yRes, g_dpi);

			// compute force scaling factor
			var fChan = This.inkSource.traceFormat.channels["F"];
			if (fChan)
			{
				This.fFactor = 1 / (fChan.max - fChan.min);
				This.fNeutral = (fChan.max - fChan.min) / 2;
			}
		}

		var inkmlTimestamp = $(inkmlContext).find("inkml\\:timestamp, timestamp");
		if (inkmlTimestamp.length)
			this.timestamp = new InkTimestamp(inkmlTimestamp);
	},

	toInkML: function (inkml)
	{
		var inkmlContext = inkml.createElementNS(c_inkmlNS, "inkml:context");

		if (this.inkSource)
		{
			var inkmlInkSource = this.inkSource.toInkML(inkml);
			inkmlContext.appendChild(inkmlInkSource);
		}

		if (this.timestamp)
		{
			var inkmlTimestamp = this.timestamp.toInkML(inkml);
			inkmlContext.appendChild(inkmlTimestamp);
		}

		return inkmlContext;
	}
});

// InkSource class
InkSource = function (inkmlInkSource)
{
	this.init(inkmlInkSource);
}
$.extend(InkSource.prototype,
{
	// init this object by deserializing an InkML inkSource
	init: function (inkmlInkSource)
	{
		// members
		this.id = $(inkmlInkSource).attr("xml:id");
		if (this.id == null)
			this.id = $(inkmlInkSource).attr("id");
		this.traceFormat = null;
		this.channelProperties = [];

		var inkmlTraceFormat = $(inkmlInkSource).find("inkml\\:traceFormat, traceFormat");
		if (inkmlTraceFormat.length < 1)
			alert("error: traceFormat is required on inkSource");
		var inkmlChannelProperties = $(inkmlInkSource).find("inkml\\:channelProperties, channelProperties");

		this.traceFormat = new InkTraceFormat(inkmlTraceFormat, inkmlChannelProperties);

		this.channels = {};

		var This = this;

		// iterate over the channelProperties
		$(inkmlInkSource).find("inkml\\:channelProperty, channelProperty").each(function ()
		{
			var channelProperty = new InkChannelProperty($(this));
			This.channelProperties.push(channelProperty);
		});
	},

	toInkML: function (inkml)
	{
		var inkmlSource = inkml.createElementNS(c_inkmlNS, "inkml:inkSource");

		var xmlid = inkml.createAttributeNS(c_xmlNS, "xml:id");
		xmlid.nodeValue = this.id;
		inkmlSource.setAttributeNode(xmlid);

		var inkmlTraceFormat = this.traceFormat.toInkML(inkml);
		inkmlSource.appendChild(inkmlTraceFormat);

		var inkmlChannelProperties = inkml.createElementNS(c_inkmlNS, "inkml:channelProperties");
		inkmlSource.appendChild(inkmlChannelProperties);

		$.each(this.channelProperties, function (index, channelProperty)
		{
			var inkmlChannelProperty = channelProperty.toInkML(inkml);
			inkmlChannelProperties.appendChild(inkmlChannelProperty);
		});

		return inkmlSource;
	}
});

// InkTimestamp class
InkTimestamp = function (inkmlTimestamp)
{
	this.init(inkmlTimestamp);
}
$.extend(InkTimestamp.prototype,
{
	// init this object by deserializing an InkML timestamp
	init: function (inkmlTimestamp)
	{
		// members
		this.id = $(inkmlTimestamp).attr("xml:id");
		if (this.id == null)
			this.id = $(inkmlTimestamp).attr("id");
		this.timeString = $(inkmlTimestamp).attr("timeString");
	},

	toInkML: function (inkml)
	{
		var inkmlTimestamp = inkml.createElementNS(c_inkmlNS, "inkml:timestamp");

		var xmlid = inkml.createAttributeNS(c_xmlNS, "xml:id");
		xmlid.nodeValue = this.id;
		inkmlTimestamp.setAttributeNode(xmlid);

		inkmlTimestamp.setAttribute("timeString", this.timeString);

		return inkmlTimestamp;
	}
});

// InkTraceFormat class
InkTraceFormat = function (inkmlTraceFormat, inkmlChannelProperties)
{
	this.init(inkmlTraceFormat, inkmlChannelProperties);
}
$.extend(InkTraceFormat.prototype,
{
	// init this object by deserializing an InkML traceFormat and an optional channelProperties
	init: function (inkmlTraceFormat, inkmlChannelProperties)
	{
		// members
		this.id = $(inkmlTraceFormat).attr("xml:id");
		if (this.id == null)
			this.id = $(inkmlTraceFormat).attr("id");

		this.channels = {};

		var This = this;

		// iterate over the channels
		$(inkmlTraceFormat).find("inkml\\:channel, channel").each(function ()
		{
			var name = $(this).attr("name");
			var channel = new InkChannel($(this), inkmlChannelProperties);
			This.channels[name] = channel;
		});
	},

	toInkML: function (inkml)
	{
		var inkmlTraceFormat = inkml.createElementNS(c_inkmlNS, "inkml:traceFormat");

		var xmlid = inkml.createAttributeNS(c_xmlNS, "xml:id");
		xmlid.nodeValue = this.id;
		inkmlTraceFormat.setAttributeNode(xmlid);

		$.each(this.channels, function (name, channel)
		{
			var inkmlChannel = channel.toInkML(inkml);
			inkmlTraceFormat.appendChild(inkmlChannel);
		});

		return inkmlTraceFormat;
	}
});

// InkChannel class
InkChannel = function (inkmlChannel, inkmlChannelProperties)
{
	this.init(inkmlChannel, inkmlChannelProperties);
}
$.extend(InkChannel.prototype,
{
	// init this object by deserializing an InkML InkChannel and an optional channelProperties
	init: function (inkmlChannel, inkmlChannelProperties)
	{
		// members
		this.name = inkmlChannel.attr("name");
		this.type = inkmlChannel.attr("type");
		var minAttr = inkmlChannel.attr("min");
		if (minAttr == null)
			this.min = 0;
		else
			this.min = parseFloat(minAttr);
		this.max = parseFloat(inkmlChannel.attr("max"));
		this.units = inkmlChannel.attr("units");
		this.resolution = 0;

		var This = this;

		var resProp = inkmlChannelProperties.find("inkml\\:channelProperty[channel='" + this.name + "'][name='resolution'], channelProperty[channel='" + this.name + "'][name='resolution']");
		if (resProp.length)
		{
			var value = resProp.attr("value");
			var units = resProp.attr("units");
			if (units.substr(0, 2) != "1/")
				alert("error: units of resolution property expected to be 1/unit");
			units = units.substring(2);
			if (This.units != units)
				alert("error: units of resolution property expected to be same as channel");
			This.resolution = value;
		}
	},

	toInkML: function (inkml)
	{
		var inkmlChannel = inkml.createElementNS(c_inkmlNS, "inkml:channel");

		inkmlChannel.setAttribute("name", this.name);
		inkmlChannel.setAttribute("type", this.type);
		if (this.min != 0)
			inkmlChannel.setAttribute("min", this.min);
		inkmlChannel.setAttribute("max", this.max);
		inkmlChannel.setAttribute("units", this.units);

		return inkmlChannel;
	}
});

// InkChannelProperty class
InkChannelProperty = function (inkmlChannelProperty)
{
	this.init(inkmlChannelProperty);
}
$.extend(InkChannelProperty.prototype,
{
	// init this object by deserializing an InkML InkChannelProperty
	init: function (inkmlChannelProperty)
	{
		// members
		this.channel = inkmlChannelProperty.attr("channel");
		this.name = inkmlChannelProperty.attr("name");
		this.value = parseFloat(inkmlChannelProperty.attr("value"));
		this.units = inkmlChannelProperty.attr("units");
	},

	toInkML: function (inkml)
	{
		var inkmlChannelProperty = inkml.createElementNS(c_inkmlNS, "inkml:channelProperty");

		inkmlChannelProperty.setAttribute("channel", this.channel);
		inkmlChannelProperty.setAttribute("name", this.name);
		inkmlChannelProperty.setAttribute("value", this.value);
		inkmlChannelProperty.setAttribute("units", this.units);

		return inkmlChannelProperty;
	}
});

// InkBrush class
InkBrush = function (inkmlBrush)
{
	this.init(inkmlBrush);
}
$.extend(InkBrush.prototype,
{
	// init this object by deserializing an InkML brush
	init: function (inkmlBrush)
	{
		// members
		this.width = 10;
		this.color = "#000000";
		this.brushProperties = {};

		var This = this;

		// iterate over the brushes
		$(inkmlBrush).find("inkml\\:brushProperty, brushProperty").each(function ()
		{
			var name = $(this).attr("name");
			switch (name)
			{
				case "color":
					This.color = $(this).attr("value");
					break;
				case "width":
					This.width = UnitsToHiMetric(parseFloat($(this).attr("value")), $(this).attr("units"));
					break;
				default:
					break;
			}

			var brushProperty = new InkBrushProperty($(this));
			This.brushProperties[name] = brushProperty;
		});
	},

	toInkML: function (inkml)
	{
		var inkmlBrush = inkml.createElementNS(c_inkmlNS, "inkml:brush");

		$.each(this.brushProperties, function (name, brushProperty)
		{
			var inkmlBrushProperty = brushProperty.toInkML(inkml);
			inkmlBrush.appendChild(inkmlBrushProperty);
		});

		return inkmlBrush;
	}
});


// InkBrushProperty class
InkBrushProperty = function (inkmlBrushProperty)
{
	this.init(inkmlBrushProperty);
}
$.extend(InkBrushProperty.prototype,
{
	// init this object by deserializing an InkML BrushProperty
	init: function (inkmlBrushProperty)
	{
		// members
		this.name = inkmlBrushProperty.attr("name");
		this.value = inkmlBrushProperty.attr("value");
		this.units = inkmlBrushProperty.attr("units");
	},

	toInkML: function (inkml)
	{
		var inkmlBrushProperty = inkml.createElementNS(c_inkmlNS, "inkml:brushProperty");

		inkmlBrushProperty.setAttribute("name", this.name);
		inkmlBrushProperty.setAttribute("value", this.value);
		inkmlBrushProperty.setAttribute("units", this.units);

		return inkmlBrushProperty;
	}
});

// InkTrace class
InkTrace = function (ink, inkmlTrace)
{
	this.init(ink, inkmlTrace);
}
$.extend(InkTrace.prototype,
{
	// init this object with an ink object and an InkML trace
	init: function (ink, inkmlTrace)
	{
		// members
		this.ink = ink;
		this.table = [];
		this.brushRef = inkmlTrace.attr("brushRef");
		this.contextRef = inkmlTrace.attr("contextRef");
		this.timeOffset = inkmlTrace.attr("timeOffset");

		var This = this;

		// iterate over each coord in the trace
		var trace = inkmlTrace.text();
		var packets = trace.split(",");
		var iPacket = 0;
		while (iPacket < packets.length)
		{
			This.table.push([]);
			var packet = packets[iPacket];

			var iProp = 0;
			var thisValue = "";
			var iChar = 0;
			while (iChar < packet.length)
			{
				var ch = packet.charAt(iChar);

				if (isDigit(ch))
				{
					thisValue += ch;
				}
				else
				{
					if (thisValue.length > 0)
					{
						This.table[iPacket].push(parseInt(thisValue));
						if (ch == "-")
						{
							thisValue = ch;
						}
						else
						{
							thisValue = "";
						}
					}
					else
					{
						if (ch == "-")
						{
							thisValue = ch;
						}
					}
				}
				iChar += 1;
			}

			if (thisValue.length > 0)
			{
				This.table[iPacket].push(parseInt(thisValue));
				thisValue = "";
			}

			iPacket += 1;
		}

		// TODO: remove hack: hard coded assumption that
		// first packet is !, the second is ', and the rest are "
		var deltas = [];
		for (var i = 0; i < This.table.length; i++)
		{
			for (var j = 0; j < This.table[i].length; j++)
			{
				if (i == 1)
				{
					// first derivative
					deltas.push(This.table[i][j]);
					This.table[i][j] = This.table[i - 1][j] + deltas[j];
				}
				else if (i > 1)
				{
					// second derivative
					deltas[j] += This.table[i][j];
					This.table[i][j] = This.table[i - 1][j] + deltas[j];
				}

				if (This.ink.mins.length <= j)
					This.ink.mins.push(This.table[i][j])
				else
				{
					if (This.ink.mins[j] > This.table[i][j])
						This.ink.mins[j] = This.table[i][j];
				}

				if (This.ink.maxs.length <= j)
					This.ink.maxs.push(This.table[i][j])
				else
				{
					if (This.ink.maxs[j] < This.table[i][j])
						This.ink.maxs[j] = This.table[i][j];
				}

				if (This.ink.sums.length <= j)
				{
					This.ink.sums.push(This.table[i][j])
					This.ink.count++;
				}
				else
				{
					This.ink.sums[j] += This.table[i][j];
					This.ink.count++;
				}
			}
		}
	},

	toInkML: function (inkml)
	{
		var inkmlTrace = inkml.createElementNS(c_inkmlNS, "inkml:trace");

		inkmlTrace.setAttribute("contextRef", this.contextRef);
		inkmlTrace.setAttribute("brushRef", this.brushRef);
		inkmlTrace.setAttribute("timeOffset", this.timeOffset);

		// TODO: do first and second derivative calc to compress output
		var traceText = "";
		$.each(this.table, function (index, row)
		{
			if (traceText.length)
				traceText += ",";
			var colText = "";
			$.each(row, function (index, col)
			{
				if (colText.length)
					colText += " ";
				colText += col;
			});
			traceText += colText;
		});
		var inkmlTraceText = inkml.createTextNode(traceText);
		inkmlTrace.appendChild(inkmlTraceText);

		return inkmlTrace;
	}
});

// Utilities

function isDigit(ch)
{
	if (ch.length > 1)
	{
		return false;
	}
	var string = "1234567890";
	if (string.indexOf(ch) != -1)
	{
		return true;
	}
	return false;
}

var HiMetricPerUnit =
{
	"m": 100000,
	"cm": 1000,
	"mm": 100,
	"in": 2540,
	"pt": 35.27778,
	"pc": 424.3333
};

function HiMetricToUnits(value, unit)
{
	var factor = HiMetricPerUnit[units];
	if (factor == null)
		return value;
	var result = value * (1 / factor);
	return result;
}

function UnitsToHiMetric(value, units)
{
	var factor = HiMetricPerUnit[units];
	if (factor == null)
		return value;
	var result = value * factor;
	return result;
}

function PixelToHiMetric(pixel, dpi)
{
	var himetric = (pixel * 2540) / dpi;
	return himetric;
}

function HiMetricToPixel(himetric, dpi)
{
	var pixel = (himetric * dpi) / 2540;
	return pixel;
}
