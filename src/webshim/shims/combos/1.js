/*!	SWFMini - a SWFObject 2.2 cut down version for webshims
 * 
 * based on SWFObject v2.2 <http://code.google.com/p/swfobject/> 
	is released under the MIT License <http://www.opensource.org/licenses/mit-license.php> 
*/

var swfmini = function() {
	
	var UNDEF = "undefined",
		OBJECT = "object",
		webshims = jQuery.webshims,
		SHOCKWAVE_FLASH = "Shockwave Flash",
		SHOCKWAVE_FLASH_AX = "ShockwaveFlash.ShockwaveFlash",
		FLASH_MIME_TYPE = "application/x-shockwave-flash",
		
		win = window,
		doc = document,
		nav = navigator,
		
		plugin = false,
		domLoadFnArr = [main],
		objIdArr = [],
		listenersArr = [],
		storedAltContent,
		storedAltContentId,
		storedCallbackFn,
		storedCallbackObj,
		isDomLoaded = false,
		dynamicStylesheet,
		dynamicStylesheetMedia,
		autoHideShow = true,
	
	/* Centralized function for browser feature detection
		- User agent string detection is only used when no good alternative is possible
		- Is executed directly for optimal performance
	*/	
	ua = function() {
		var w3cdom = typeof doc.getElementById != UNDEF && typeof doc.getElementsByTagName != UNDEF && typeof doc.createElement != UNDEF,
			u = nav.userAgent.toLowerCase(),
			p = nav.platform.toLowerCase(),
			windows = p ? /win/.test(p) : /win/.test(u),
			mac = p ? /mac/.test(p) : /mac/.test(u),
			webkit = /webkit/.test(u) ? parseFloat(u.replace(/^.*webkit\/(\d+(\.\d+)?).*$/, "$1")) : false, // returns either the webkit version or false if not webkit
			ie = !+"\v1", // feature detection based on Andrea Giammarchi's solution: http://webreflection.blogspot.com/2009/01/32-bytes-to-know-if-your-browser-is-ie.html
			playerVersion = [0,0,0],
			d = null;
		if (typeof nav.plugins != UNDEF && typeof nav.plugins[SHOCKWAVE_FLASH] == OBJECT) {
			d = nav.plugins[SHOCKWAVE_FLASH].description;
			if (d && !(typeof nav.mimeTypes != UNDEF && nav.mimeTypes[FLASH_MIME_TYPE] && !nav.mimeTypes[FLASH_MIME_TYPE].enabledPlugin)) { // navigator.mimeTypes["application/x-shockwave-flash"].enabledPlugin indicates whether plug-ins are enabled or disabled in Safari 3+
				plugin = true;
				ie = false; // cascaded feature detection for Internet Explorer
				d = d.replace(/^.*\s+(\S+\s+\S+$)/, "$1");
				playerVersion[0] = parseInt(d.replace(/^(.*)\..*$/, "$1"), 10);
				playerVersion[1] = parseInt(d.replace(/^.*\.(.*)\s.*$/, "$1"), 10);
				playerVersion[2] = /[a-zA-Z]/.test(d) ? parseInt(d.replace(/^.*[a-zA-Z]+(.*)$/, "$1"), 10) : 0;
			}
		}
		else if (typeof win.ActiveXObject != UNDEF) {
			try {
				var a = new ActiveXObject(SHOCKWAVE_FLASH_AX);
				if (a) { // a will return null when ActiveX is disabled
					d = a.GetVariable("$version");
					if (d) {
						ie = true; // cascaded feature detection for Internet Explorer
						d = d.split(" ")[1].split(",");
						playerVersion = [parseInt(d[0], 10), parseInt(d[1], 10), parseInt(d[2], 10)];
					}
				}
			}
			catch(e) {}
		}
		return { w3:w3cdom, pv:playerVersion, wk:webkit, ie:ie, win:windows, mac:mac };
	}();
	
	
	function callDomLoadFunctions() {
		if (isDomLoaded) { return; }
		try { // test if we can really add/remove elements to/from the DOM; we don't want to fire it too early
			var t = doc.getElementsByTagName("body")[0].appendChild(createElement("span"));
			t.parentNode.removeChild(t);
		}
		catch (e) { return; }
		isDomLoaded = true;
		var dl = domLoadFnArr.length;
		for (var i = 0; i < dl; i++) {
			domLoadFnArr[i]();
		}
	}
	
	function addDomLoadEvent(fn) {
		if (isDomLoaded) {
			fn();
		}
		else { 
			domLoadFnArr[domLoadFnArr.length] = fn; // Array.push() is only available in IE5.5+
		}
	}
	
	/* Cross-browser onload
		- Based on James Edwards' solution: http://brothercake.com/site/resources/scripts/onload/
		- Will fire an event as soon as a web page including all of its assets are loaded 
	 */
	function addLoadEvent(fn) {
		
	}
	
	/* Main function
		- Will preferably execute onDomLoad, otherwise onload (as a fallback)
	*/
	function main() { 
		if (plugin) {
			testPlayerVersion();
		}
	}
	
	/* Detect the Flash Player version for non-Internet Explorer browsers
		- Detecting the plug-in version via the object element is more precise than using the plugins collection item's description:
		  a. Both release and build numbers can be detected
		  b. Avoid wrong descriptions by corrupt installers provided by Adobe
		  c. Avoid wrong descriptions by multiple Flash Player entries in the plugin Array, caused by incorrect browser imports
		- Disadvantage of this method is that it depends on the availability of the DOM, while the plugins collection is immediately available
	*/
	function testPlayerVersion() {
		var b = doc.getElementsByTagName("body")[0];
		var o = createElement(OBJECT);
		o.setAttribute("type", FLASH_MIME_TYPE);
		var t = b.appendChild(o);
		if (t) {
			var counter = 0;
			(function(){
				if (typeof t.GetVariable != UNDEF) {
					var d = t.GetVariable("$version");
					if (d) {
						d = d.split(" ")[1].split(",");
						ua.pv = [parseInt(d[0], 10), parseInt(d[1], 10), parseInt(d[2], 10)];
					}
				}
				else if (counter < 10) {
					counter++;
					setTimeout(arguments.callee, 10);
					return;
				}
				b.removeChild(o);
				t = null;
			})();
		}
	}
	
	
	function getObjectById(objectIdStr) {
		var r = null;
		var o = getElementById(objectIdStr);
		if (o && o.nodeName == "OBJECT") {
			if (typeof o.SetVariable != UNDEF) {
				r = o;
			}
			else {
				var n = o.getElementsByTagName(OBJECT)[0];
				if (n) {
					r = n;
				}
			}
		}
		return r;
	}
	
	
	/* Functions to abstract and display alternative content
	*/
	function displayAltContent(obj) {
		if (ua.ie && ua.win && obj.readyState != 4) {
			// IE only: when a SWF is loading (AND: not available in cache) wait for the readyState of the object element to become 4 before removing it,
			// because you cannot properly cancel a loading SWF file without breaking browser load references, also obj.onreadystatechange doesn't work
			var el = createElement("div");
			obj.parentNode.insertBefore(el, obj); // insert placeholder div that will be replaced by the alternative content
			el.parentNode.replaceChild(abstractAltContent(obj), el);
			obj.style.display = "none";
			(function(){
				if (obj.readyState == 4) {
					obj.parentNode.removeChild(obj);
				}
				else {
					setTimeout(arguments.callee, 10);
				}
			})();
		}
		else {
			obj.parentNode.replaceChild(abstractAltContent(obj), obj);
		}
	} 

	function abstractAltContent(obj) {
		var ac = createElement("div");
		if (ua.win && ua.ie) {
			ac.innerHTML = obj.innerHTML;
		}
		else {
			var nestedObj = obj.getElementsByTagName(OBJECT)[0];
			if (nestedObj) {
				var c = nestedObj.childNodes;
				if (c) {
					var cl = c.length;
					for (var i = 0; i < cl; i++) {
						if (!(c[i].nodeType == 1 && c[i].nodeName == "PARAM") && !(c[i].nodeType == 8)) {
							ac.appendChild(c[i].cloneNode(true));
						}
					}
				}
			}
		}
		return ac;
	}
	
	/* Cross-browser dynamic SWF creation
	*/
	function createSWF(attObj, parObj, id) {
		var r, el = getElementById(id);
		if (ua.wk && ua.wk < 312) { return r; }
		if (el) {
			if (typeof attObj.id == UNDEF) { // if no 'id' is defined for the object element, it will inherit the 'id' from the alternative content
				attObj.id = id;
			}
			if (ua.ie && ua.win) { // Internet Explorer + the HTML object element + W3C DOM methods do not combine: fall back to outerHTML
				var att = "";
				for (var i in attObj) {
					if (attObj[i] != Object.prototype[i]) { // filter out prototype additions from other potential libraries
						if (i.toLowerCase() == "data") {
							parObj.movie = attObj[i];
						}
						else if (i.toLowerCase() == "styleclass") { // 'class' is an ECMA4 reserved keyword
							att += ' class="' + attObj[i] + '"';
						}
						else if (i.toLowerCase() != "classid") {
							att += ' ' + i + '="' + attObj[i] + '"';
						}
					}
				}
				var par = "";
				for (var j in parObj) {
					if (parObj[j] != Object.prototype[j]) { // filter out prototype additions from other potential libraries
						par += '<param name="' + j + '" value="' + parObj[j] + '" />';
					}
				}
				el.outerHTML = '<object classid="clsid:D27CDB6E-AE6D-11cf-96B8-444553540000"' + att + '>' + par + '</object>';
				objIdArr[objIdArr.length] = attObj.id; // stored to fix object 'leaks' on unload (dynamic publishing only)
				r = getElementById(attObj.id);	
			}
			else { // well-behaving browsers
				var o = createElement(OBJECT);
				o.setAttribute("type", FLASH_MIME_TYPE);
				for (var m in attObj) {
					if (attObj[m] != Object.prototype[m]) { // filter out prototype additions from other potential libraries
						if (m.toLowerCase() == "styleclass") { // 'class' is an ECMA4 reserved keyword
							o.setAttribute("class", attObj[m]);
						}
						else if (m.toLowerCase() != "classid") { // filter out IE specific attribute
							o.setAttribute(m, attObj[m]);
						}
					}
				}
				for (var n in parObj) {
					if (parObj[n] != Object.prototype[n] && n.toLowerCase() != "movie") { // filter out prototype additions from other potential libraries and IE specific param element
						createObjParam(o, n, parObj[n]);
					}
				}
				el.parentNode.replaceChild(o, el);
				r = o;
			}
		}
		return r;
	}
	
	function createObjParam(el, pName, pValue) {
		var p = createElement("param");
		p.setAttribute("name", pName);	
		p.setAttribute("value", pValue);
		el.appendChild(p);
	}
	
	/* Cross-browser SWF removal
		- Especially needed to safely and completely remove a SWF in Internet Explorer
	*/
	function removeSWF(id) {
		var obj = getElementById(id);
		if (obj && obj.nodeName == "OBJECT") {
			if (ua.ie && ua.win) {
				obj.style.display = "none";
				(function(){
					if (obj.readyState == 4) {
						removeObjectInIE(id);
					}
					else {
						setTimeout(arguments.callee, 10);
					}
				})();
			}
			else {
				obj.parentNode.removeChild(obj);
			}
		}
	}
	
	function removeObjectInIE(id) {
		var obj = getElementById(id);
		if (obj) {
			for (var i in obj) {
				if (typeof obj[i] == "function") {
					obj[i] = null;
				}
			}
			obj.parentNode.removeChild(obj);
		}
	}
	
	/* Functions to optimize JavaScript compression
	*/
	function getElementById(id) {
		var el = null;
		try {
			el = doc.getElementById(id);
		}
		catch (e) {}
		return el;
	}
	
	function createElement(el) {
		return doc.createElement(el);
	}
	
	/* Updated attachEvent function for Internet Explorer
		- Stores attachEvent information in an Array, so on unload the detachEvent functions can be called to avoid memory leaks
	*/	
	function addListener(target, eventType, fn) {
		target.attachEvent(eventType, fn);
		listenersArr[listenersArr.length] = [target, eventType, fn];
	}
	
	/* Flash Player and SWF content version matching
	*/
	function hasPlayerVersion(rv) {
		var pv = ua.pv, v = rv.split(".");
		v[0] = parseInt(v[0], 10);
		v[1] = parseInt(v[1], 10) || 0; // supports short notation, e.g. "9" instead of "9.0.0"
		v[2] = parseInt(v[2], 10) || 0;
		return (pv[0] > v[0] || (pv[0] == v[0] && pv[1] > v[1]) || (pv[0] == v[0] && pv[1] == v[1] && pv[2] >= v[2])) ? true : false;
	}
	
	
	
	function setVisibility(id, isVisible) {
		if (!autoHideShow) { return; }
		var elem;
		var v = isVisible ? "visible" : "hidden";
		if (isDomLoaded && (elem && getElementById(id))) {
			getElementById(id).style.visibility = v;
		}
	}

	/* Release memory to avoid memory leaks caused by closures, fix hanging audio/video threads and force open sockets/NetConnections to disconnect (Internet Explorer only)
	*/
	var cleanup = function() {
		if (ua.ie && ua.win && window.attachEvent) {
			window.attachEvent("onunload", function() {
				// remove listeners to avoid memory leaks
				var ll = listenersArr.length;
				for (var i = 0; i < ll; i++) {
					listenersArr[i][0].detachEvent(listenersArr[i][1], listenersArr[i][2]);
				}
				// cleanup dynamically embedded objects to fix audio/video threads and force open sockets and NetConnections to disconnect
				var il = objIdArr.length;
				for (var j = 0; j < il; j++) {
					removeSWF(objIdArr[j]);
				}
				// cleanup library's main closures to avoid memory leaks
				for (var k in ua) {
					ua[k] = null;
				}
				ua = null;
				for (var l in swfmini) {
					swfmini[l] = null;
				}
				swfmini = null;
			});
		}
	}();
	
	webshims.ready('DOM', callDomLoadFunctions);
	
	return {
		/* Public API
			- Reference: http://code.google.com/p/swfobject/wiki/documentation
		*/ 
		registerObject: function() {
			
		},
		
		getObjectById: function(objectIdStr) {
			if (ua.w3) {
				return getObjectById(objectIdStr);
			}
		},
		
		embedSWF: function(swfUrlStr, replaceElemIdStr, widthStr, heightStr, swfVersionStr, xiSwfUrlStr, flashvarsObj, parObj, attObj, callbackFn) {
			var callbackObj = {success:false, id:replaceElemIdStr};
			if (ua.w3 && !(ua.wk && ua.wk < 312) && swfUrlStr && replaceElemIdStr && widthStr && heightStr && swfVersionStr) {
				setVisibility(replaceElemIdStr, false);
				addDomLoadEvent(function() {
					widthStr += ""; // auto-convert to string
					heightStr += "";
					var att = {};
					if (attObj && typeof attObj === OBJECT) {
						for (var i in attObj) { // copy object to avoid the use of references, because web authors often reuse attObj for multiple SWFs
							att[i] = attObj[i];
						}
					}
					att.data = swfUrlStr;
					att.width = widthStr;
					att.height = heightStr;
					var par = {}; 
					if (parObj && typeof parObj === OBJECT) {
						for (var j in parObj) { // copy object to avoid the use of references, because web authors often reuse parObj for multiple SWFs
							par[j] = parObj[j];
						}
					}
					if (flashvarsObj && typeof flashvarsObj === OBJECT) {
						for (var k in flashvarsObj) { // copy object to avoid the use of references, because web authors often reuse flashvarsObj for multiple SWFs
							if (typeof par.flashvars != UNDEF) {
								par.flashvars += "&" + k + "=" + flashvarsObj[k];
							}
							else {
								par.flashvars = k + "=" + flashvarsObj[k];
							}
						}
					}
					if (hasPlayerVersion(swfVersionStr)) { // create SWF
						var obj = createSWF(att, par, replaceElemIdStr);
						if (att.id == replaceElemIdStr) {
							setVisibility(replaceElemIdStr, true);
						}
						callbackObj.success = true;
						callbackObj.ref = obj;
					}
					else { // show alternative content
						setVisibility(replaceElemIdStr, true);
					}
					if (callbackFn) { callbackFn(callbackObj); }
				});
			}
			else if (callbackFn) { callbackFn(callbackObj);	}
		},
		
		switchOffAutoHideShow: function() {
			autoHideShow = false;
		},
		
		ua: ua,
		
		getFlashPlayerVersion: function() {
			return { major:ua.pv[0], minor:ua.pv[1], release:ua.pv[2] };
		},
		
		hasFlashPlayerVersion: hasPlayerVersion,
		
		createSWF: function(attObj, parObj, replaceElemIdStr) {
			if (ua.w3) {
				return createSWF(attObj, parObj, replaceElemIdStr);
			}
			else {
				return undefined;
			}
		},
		
		showExpressInstall: function() {
			
		},
		
		removeSWF: function(objElemIdStr) {
			if (ua.w3) {
				removeSWF(objElemIdStr);
			}
		},
		
		createCSS: function() {
			
		},
		
		addDomLoadEvent: addDomLoadEvent,
		
		addLoadEvent: addLoadEvent,
		
		
		// For internal usage only
		expressInstallCallback: function() {
			
		}
	};
}();

//additional tests for partial implementation of forms features
(function($){
	"use strict";
	var isWebkit = 'webkitURL' in window;
	var Modernizr = window.Modernizr;
	var webshims = $.webshims;
	var bugs = webshims.bugs;
	var form = $('<form action="#" style="width: 1px; height: 1px; overflow: hidden;"><select name="b" required="" /><input required="" name="a" /></form>');
	var testRequiredFind = function(){
		if(form[0].querySelector){
			try {
				bugs.findRequired = !(form[0].querySelector('select:required'));
			} catch(er){
				bugs.findRequired = false;
			}
		}
	};
	var inputElem = $('input', form).eq(0);
	var onDomextend = function(fn){
		webshims.loader.loadList(['dom-extend']);
		webshims.ready('dom-extend', fn);
	};
	
	bugs.findRequired = false;
	bugs.validationMessage = false;
	
	webshims.capturingEventPrevented = function(e){
		if(!e._isPolyfilled){
			var isDefaultPrevented = e.isDefaultPrevented;
			var preventDefault = e.preventDefault;
			e.preventDefault = function(){
				clearTimeout($.data(e.target, e.type + 'DefaultPrevented'));
				$.data(e.target, e.type + 'DefaultPrevented', setTimeout(function(){
					$.removeData(e.target, e.type + 'DefaultPrevented');
				}, 30));
				return preventDefault.apply(this, arguments);
			};
			e.isDefaultPrevented = function(){
				return !!(isDefaultPrevented.apply(this, arguments) || $.data(e.target, e.type + 'DefaultPrevented') || false);
			};
			e._isPolyfilled = true;
		}
	};
	
	if(!Modernizr.formvalidation || bugs.bustedValidity){
		testRequiredFind();
	} else {
		//create delegatable events
		webshims.capturingEvents(['invalid'], true);
		
		if(window.opera || window.testGoodWithFix){
			
			form.appendTo('head');
			
			testRequiredFind();
			bugs.validationMessage = !(inputElem.prop('validationMessage'));
			
			webshims.reTest(['form-native-extend', 'form-message']);
			
			form.remove();
				
			$(function(){
				onDomextend(function(){
					
					//Opera shows native validation bubbles in case of input.checkValidity()
					// Opera 11.6/12 hasn't fixed this issue right, it's buggy
					var preventDefault = function(e){
						e.preventDefault();
					};
					
					['form', 'input', 'textarea', 'select'].forEach(function(name){
						var desc = webshims.defineNodeNameProperty(name, 'checkValidity', {
							prop: {
								value: function(){
									if (!webshims.fromSubmit) {
										$(this).on('invalid.checkvalidity', preventDefault);
									}
									
									webshims.fromCheckValidity = true;
									var ret = desc.prop._supvalue.apply(this, arguments);
									if (!webshims.fromSubmit) {
										$(this).unbind('invalid.checkvalidity', preventDefault);
									}
									webshims.fromCheckValidity = false;
									return ret;
								}
							}
						});
					});
					
				});
			});
		}
		
		if(isWebkit && !webshims.bugs.bustedValidity){
			(function(){
				var elems = /^(?:textarea|input)$/i;
				var form = false;
				
				document.addEventListener('contextmenu', function(e){
					if(elems.test( e.target.nodeName || '') && (form = e.target.form)){
						setTimeout(function(){
							form = false;
						}, 1);
					}
				}, false);
				
				$(window).on('invalid', function(e){
					if(e.originalEvent && form && form == e.target.form){
						e.wrongWebkitInvalid = true;
						e.stopImmediatePropagation();
					}
				});
				
			})();
		}
	}

	$.webshims.register('form-core', function($, webshims, window, document, undefined, options){
	
		var checkTypes = {checkbox: 1, radio: 1};
		var emptyJ = $([]);
		var bugs = webshims.bugs;
		var getGroupElements = function(elem){
			elem = $(elem);
			var name;
			var form;
			var ret = emptyJ;
			if(elem[0].type == 'radio'){
				form = elem.prop('form');
				name = elem[0].name;
				if(!name){
					ret = elem;
				} else if(form){
					ret = $(form[name]);
				} else {
					ret = $(document.getElementsByName(name)).filter(function(){
						return !$.prop(this, 'form');
					});
				}
				ret = ret.filter('[type="radio"]');
			}
			return ret;
		};
		
		var getContentValidationMessage = webshims.getContentValidationMessage = function(elem, validity, key){
			var message = $(elem).data('errormessage') || elem.getAttribute('x-moz-errormessage') || '';
			if(key && message[key]){
				message = message[key];
			}
			if(typeof message == 'object'){
				validity = validity || $.prop(elem, 'validity') || {valid: 1};
				if(!validity.valid){
					$.each(validity, function(name, prop){
						if(prop && name != 'valid' && message[name]){
							message = message[name];
							return false;
						}
					});
				}
			}
			
			if(typeof message == 'object'){
				message = message.defaultMessage;
			}
			return message || '';
		};
		
		/*
		 * Selectors for all browsers
		 */
		var rangeTypes = {number: 1, range: 1, date: 1/*, time: 1, 'datetime-local': 1, datetime: 1, month: 1, week: 1*/};
		var hasInvalid = function(elem){
			var ret = false;
			$($.prop(elem, 'elements')).each(function(){
				ret = $(this).is(':invalid');
				if(ret){
					return false;
				}
			});
			return ret;
		};
		$.extend($.expr[":"], {
			"valid-element": function(elem){
				return $.nodeName(elem, 'form') ? !hasInvalid(elem) :!!($.prop(elem, 'willValidate') && isValid(elem));
			},
			"invalid-element": function(elem){
				return $.nodeName(elem, 'form') ? hasInvalid(elem) : !!($.prop(elem, 'willValidate') && !isValid(elem));
			},
			"required-element": function(elem){
				return !!($.prop(elem, 'willValidate') && $.prop(elem, 'required'));
			},
			"user-error": function(elem){
				return ($.prop(elem, 'willValidate') && $(elem).hasClass('user-error'));
			},
			"optional-element": function(elem){
				return !!($.prop(elem, 'willValidate') && $.prop(elem, 'required') === false);
			},
			"in-range": function(elem){
				if(!rangeTypes[$.prop(elem, 'type')] || !$.prop(elem, 'willValidate')){
					return false;
				}
				var val = $.prop(elem, 'validity');
				return !!(val && !val.rangeOverflow && !val.rangeUnderflow);
			},
			"out-of-range": function(elem){
				if(!rangeTypes[$.prop(elem, 'type')] || !$.prop(elem, 'willValidate')){
					return false;
				}
				var val = $.prop(elem, 'validity');
				return !!(val && (val.rangeOverflow || val.rangeUnderflow));
			}
			
		});
		
		['valid', 'invalid', 'required', 'optional'].forEach(function(name){
			$.expr[":"][name] = $.expr.filters[name+"-element"];
		});
		
		
		$.expr[":"].focus = function( elem ) {
			try {
				var doc = elem.ownerDocument;
				return elem === doc.activeElement && (!doc.hasFocus || doc.hasFocus());
			} catch(e){}
			return false;
		};
		
		
		var customEvents = $.event.customEvent || {};
		var isValid = function(elem){
			return ($.prop(elem, 'validity') || {valid: 1}).valid;
		};
		
		if (bugs.bustedValidity || bugs.findRequired) {
			(function(){
				var find = $.find;
				var matchesSelector = $.find.matchesSelector;
				
				var regExp = /(\:valid|\:invalid|\:optional|\:required|\:in-range|\:out-of-range)(?=[\s\[\~\.\+\>\:\#*]|$)/ig;
				var regFn = function(sel){
					return sel + '-element';
				};
				
				$.find = (function(){
					var slice = Array.prototype.slice;
					var fn = function(sel){
						var ar = arguments;
						ar = slice.call(ar, 1, ar.length);
						ar.unshift(sel.replace(regExp, regFn));
						return find.apply(this, ar);
					};
					for (var i in find) {
						if(find.hasOwnProperty(i)){
							fn[i] = find[i];
						}
					}
					return fn;
				})();
				if(!Modernizr.prefixed || Modernizr.prefixed("matchesSelector", document.documentElement)){
					$.find.matchesSelector = function(node, expr){
						expr = expr.replace(regExp, regFn);
						return matchesSelector.call(this, node, expr);
					};
				}
				
			})();
		}
		
		//ToDo needs testing
		var oldAttr = $.prop;
		var changeVals = {selectedIndex: 1, value: 1, checked: 1, disabled: 1, readonly: 1};
		$.prop = function(elem, name, val){
			var ret = oldAttr.apply(this, arguments);
			if(elem && 'form' in elem && changeVals[name] && val !== undefined && $(elem).hasClass(invalidClass)){
				if(isValid(elem)){
					$(elem).getShadowElement().removeClass(invalidClass);
					if(name == 'checked' && val) {
						getGroupElements(elem).not(elem).removeClass(invalidClass).removeAttr('aria-invalid');
					}
				}
			}
			return ret;
		};
		
		var returnValidityCause = function(validity, elem){
			var ret;
			$.each(validity, function(name, value){
				if(value){
					ret = (name == 'customError') ? $.prop(elem, 'validationMessage') : name;
					return false;
				}
			});
			return ret;
		};
		
		var isInGroup = function(name){
			var ret;
			try {
				ret = document.activeElement.name === name;
			} catch(e){}
			return ret;
		};
		/* form-ui-invalid/form-ui-valid are deprecated. use user-error/user-success instead */
		var invalidClass = 'user-error';
		var validClass = 'user-success';
		var stopChangeTypes = {
			time: 1,
			date: 1,
			month: 1,
			datetime: 1,
			week: 1,
			'datetime-local': 1
		};
		var switchValidityClass = function(e){
			var elem, timer;
			if(!e.target){return;}
			elem = $(e.target).getNativeElement()[0];
			if(elem.type == 'submit' || !$.prop(elem, 'willValidate')){return;}
			timer = $.data(elem, 'webshimsswitchvalidityclass');
			var switchClass = function(){
				if(e.type == 'focusout' && elem.type == 'radio' && isInGroup(elem.name)){return;}
				var validity = $.prop(elem, 'validity');
				var shadowElem = $(elem).getShadowElement();
				var addClass, removeClass, trigger, generaltrigger, validityCause;
				
				if(isWebkit && e.type == 'change' && !bugs.bustedValidity && stopChangeTypes[shadowElem.prop('type')] && shadowElem.is(':focus')){return;}
				
				$(elem).trigger('refreshCustomValidityRules');
				
				if(validity.valid){
					if(!shadowElem.hasClass(validClass)){
						addClass = validClass;
						removeClass = invalidClass;
						generaltrigger = 'changedvaliditystate';
						trigger = 'changedvalid';
						if(checkTypes[elem.type] && elem.checked){
							getGroupElements(elem).not(elem).removeClass(removeClass).addClass(addClass).removeAttr('aria-invalid');
						}
						$.removeData(elem, 'webshimsinvalidcause');
					}
				} else {
					validityCause = returnValidityCause(validity, elem);
					if($.data(elem, 'webshimsinvalidcause') != validityCause){
						$.data(elem, 'webshimsinvalidcause', validityCause);
						generaltrigger = 'changedvaliditystate';
					}
					if(!shadowElem.hasClass(invalidClass)){
						addClass = invalidClass;
						removeClass = validClass;
						if (checkTypes[elem.type] && !elem.checked) {
							getGroupElements(elem).not(elem).removeClass(removeClass).addClass(addClass);
						}
						trigger = 'changedinvalid';
					}
				}
				
				if(addClass){
					shadowElem.addClass(addClass).removeClass(removeClass);
					//jQuery 1.6.1 IE9 bug (doubble trigger bug)
					setTimeout(function(){
						$(elem).trigger(trigger);
					}, 0);
				}
				if(generaltrigger){
					setTimeout(function(){
						$(elem).trigger(generaltrigger);
					}, 0);
				}
				
				$.removeData(elem, 'webshimsswitchvalidityclass');
			};
			
			if(timer){
				clearTimeout(timer);
			}
			if(e.type == 'refreshvalidityui'){
				switchClass();
			} else {
				$.data(elem, 'webshimsswitchvalidityclass', setTimeout(switchClass, 9));
			}
		};
		
		$(document).on(options.validityUIEvents || 'focusout change refreshvalidityui', switchValidityClass);
		customEvents.changedvaliditystate = true;
		customEvents.refreshCustomValidityRules = true;
		customEvents.changedvalid = true;
		customEvents.changedinvalid = true;
		customEvents.refreshvalidityui = true;
		
		
		webshims.triggerInlineForm = function(elem, event){
			$(elem).trigger(event);
		};
		
		webshims.modules["form-core"].getGroupElements = getGroupElements;
		
		
		var setRoot = function(){
			webshims.scrollRoot = (isWebkit || document.compatMode == 'BackCompat') ?
				$(document.body) : 
				$(document.documentElement)
			;
		};
		var minWidth = (Modernizr.boxSizing || Modernizr['display-table'] || $.support.getSetAttribute) ?
			'minWidth' :
			'width'
		;
		setRoot();
		webshims.ready('DOM', setRoot);
		
		webshims.getRelOffset = function(posElem, relElem){
			posElem = $(posElem);
			var offset = $(relElem).offset();
			var bodyOffset;
			$.swap($(posElem)[0], {visibility: 'hidden', display: 'inline-block', left: 0, top: 0}, function(){
				bodyOffset = posElem.offset();
			});
			offset.top -= bodyOffset.top;
			offset.left -= bodyOffset.left;
			return offset;
		};
		
		webshims.wsPopover = {
			_create: function(){
				this.options =  $.extend({}, webshims.cfg.wspopover, this.options);
				this.id = webshims.wsPopover.id++;
				this.eventns = '.wsoverlay'+this.id;
				this.timers = {};
				this.element = $('<div class="ws-popover" tabindex="-1"><div class="ws-po-outerbox"><div class="ws-po-arrow"><div class="ws-po-arrowbox" /></div><div class="ws-po-box" /></div></div>');
				this.contentElement = $('.ws-po-box', this.element);
				this.lastElement = $([]);
				this.bindElement();
				
				this.element.data('wspopover', this);
				
			},
			options: {},
			content: function(html){
				this.contentElement.html(html);
			},
			bindElement: function(){
				var that = this;
				var stopBlur = function(){
					that.stopBlur = false;
				};
				this.preventBlur = function(e){
					that.stopBlur = true;
					clearTimeout(that.timers.stopBlur);
					that.timers.stopBlur = setTimeout(stopBlur, 9);
				};
				this.element.on({
					'mousedown': this.preventBlur
				});
			},
			
			isInElement: function(container, contained){
				return container == contained || $.contains(container, contained);
			},
			show: function(element){
				var e = $.Event('wspopoverbeforeshow');
				this.element.trigger(e);
				if(e.isDefaultPrevented() || this.isVisible){return;}
				this.isVisible = true;
				element = $(element || this.options.prepareFor).getNativeElement() ;
				
				var that = this;
				var visual = $(element).getShadowElement();
	
				this.clear();
				this.element.removeClass('ws-po-visible').css('display', 'none');
				
				this.prepareFor(element, visual);
				
				this.position(visual);
				that.timers.show = setTimeout(function(){
					that.element.css('display', '');
					that.timers.show = setTimeout(function(){
						that.element.addClass('ws-po-visible').trigger('wspopovershow');
					}, 9);
				}, 9);
				$(document).on('focusin'+this.eventns+' mousedown'+this.eventns, function(e){
					if(that.options.hideOnBlur && !that.stopBlur && !that.isInElement(that.lastElement[0] || document.body, e.target) && !that.isInElement(element[0] || document.body, e.target) && !that.isInElement(that.element[0], e.target)){
						that.hide();
					}
				});
				$(window).on('resize'+this.eventns + ' pospopover'+this.eventns, function(){
					clearTimeout(that.timers.repos);
					that.timers.repos = setTimeout(function(){
						that.position(visual);
					}, 900);
				});
			},
			prepareFor: function(element, visual){
				var onBlur;
				var opts = $.extend({}, this.options, $(element.prop('form') || []).data('wspopover') || {}, element.data('wspopover'));
				var that = this;
				var css = {};
				this.lastElement = $(element).getShadowFocusElement();
				if(opts.appendTo == 'element'){
					this.element.insertAfter(element);
				} else {
					this.element.appendTo(opts.appendTo);
				}
				
				this.element.attr({
					'data-class': element.prop('className'),
					'data-id': element.prop('id')
				});
				
				css[minWidth] = opts.constrainWidth ? visual.outerWidth() : '';
				
				this.element.css(css);
				
				if(opts.hideOnBlur){
					onBlur = function(e){
						if(that.stopBlur){
							e.stopImmediatePropagation();
						} else {
							that.hide();
						}
					};
					
					that.timers.bindBlur = setTimeout(function(){
						that.lastElement.off(that.eventns).on('focusout'+that.eventns + ' blur'+that.eventns, onBlur);
						that.lastElement.getNativeElement().off(that.eventns);
					}, 10);
					
					
				}
				
				if(!this.prepared){
					
					if($.fn.bgIframe){
						this.element.bgIframe();
					}
				}
				this.prepared = true;
			},
			clear: function(){
				$(window).off(this.eventns);
				$(document).off(this.eventns);
				
				this.stopBlur = false;
				$.each(this.timers, function(timerName, val){
					clearTimeout(val);
				});
			},
			hide: function(){
				var e = $.Event('wspopoverbeforehide');
				this.element.trigger(e);
				if(e.isDefaultPrevented() || !this.isVisible){return;}
				this.isVisible = false;
				var that = this;
				var forceHide = function(){
					that.element.css('display', 'none').attr({'data-id': '', 'data-class': '', 'hidden': 'hidden'});
					clearTimeout(that.timers.forcehide);
				};
				this.clear();
				this.element.removeClass('ws-po-visible').trigger('wspopoverhide');
				$(window).on('resize'+this.eventns, forceHide);
				that.timers.forcehide = setTimeout(forceHide, 999);
			},
			position: function(element){
				var offset = webshims.getRelOffset(this.element.css({marginTop: 0, marginLeft: 0, marginRight: 0, marginBottom: 0}).removeAttr('hidden'), element);
				offset.top += element.outerHeight();
				this.element.css({marginTop: '', marginLeft: '', marginRight: '', marginBottom: ''}).css(offset);
			}
		};
		
		webshims.wsPopover.id = 0;
		
		/* some extra validation UI */
		webshims.validityAlert = (function(){
			
			
			var focusTimer = false;
			
			var api = webshims.objectCreate(webshims.wsPopover, {}, options.messagePopover);
			var boundHide = api.hide.bind(api);
			
			api.element.addClass('validity-alert').attr({role: 'alert'});
			$.extend(api, {
				hideDelay: 5000,
				showFor: function(elem, message, noFocusElem, noBubble){
					
					elem = $(elem).getNativeElement();
					this.clear();
					this.hide();
					if(!noBubble){
						this.getMessage(elem, message);
						
						this.show(elem);
						if(this.hideDelay){
							this.timers.delayedHide = setTimeout(boundHide, this.hideDelay);
						}
						
					}
					
					if(!noFocusElem){
						this.setFocus(elem);
					}
				},
				setFocus: function(element){
					var focusElem = $(element).getShadowFocusElement();
					var scrollTop = webshims.scrollRoot.scrollTop();
					var elemTop = focusElem.offset().top - 30;
					var smooth;
					
					if(scrollTop > elemTop){
						webshims.scrollRoot.animate(
							{scrollTop: elemTop - 5}, 
							{
								queue: false, 
								duration: Math.max( Math.min( 600, (scrollTop - elemTop) * 1.5 ), 80 )
							}
						);
						smooth = true;
					}
					try {
						focusElem[0].focus();
					} catch(e){}
					if(smooth){
						webshims.scrollRoot.scrollTop(scrollTop);
						setTimeout(function(){
							webshims.scrollRoot.scrollTop(scrollTop);
						}, 0);
					}
					
					$(window).triggerHandler('pospopover'+this.eventns);
				},
				getMessage: function(elem, message){
					if (!message) {
						message = getContentValidationMessage(elem[0]) || elem.prop('customValidationMessage') || elem.prop('validationMessage');
					}
					if (message) {
						api.contentElement.text(message);
					} else {
						this.hide();
					}
				}
			});
			
			
			return api;
		})();
		
		
		/* extension, but also used to fix native implementation workaround/bugfixes */
		(function(){
			var firstEvent,
				invalids = [],
				stopSubmitTimer,
				form
			;
			
			$(document).on('invalid', function(e){
				if(e.wrongWebkitInvalid){return;}
				var jElm = $(e.target);
				var shadowElem = jElm.getShadowElement();
				if(!shadowElem.hasClass(invalidClass)){
					shadowElem.addClass(invalidClass).removeClass(validClass);
					setTimeout(function(){
						$(e.target).trigger('changedinvalid').trigger('changedvaliditystate');
					}, 0);
				}
				
				if(!firstEvent){
					//trigger firstinvalid
					firstEvent = $.Event('firstinvalid');
					firstEvent.isInvalidUIPrevented = e.isDefaultPrevented;
					var firstSystemInvalid = $.Event('firstinvalidsystem');
					$(document).triggerHandler(firstSystemInvalid, {element: e.target, form: e.target.form, isInvalidUIPrevented: e.isDefaultPrevented});
					jElm.trigger(firstEvent);
				}
	
				//if firstinvalid was prevented all invalids will be also prevented
				if( firstEvent && firstEvent.isDefaultPrevented() ){
					e.preventDefault();
				}
				invalids.push(e.target);
				e.extraData = 'fix'; 
				clearTimeout(stopSubmitTimer);
				stopSubmitTimer = setTimeout(function(){
					var lastEvent = {type: 'lastinvalid', cancelable: false, invalidlist: $(invalids)};
					//reset firstinvalid
					firstEvent = false;
					invalids = [];
					$(e.target).trigger(lastEvent, lastEvent);
				}, 9);
				jElm = null;
				shadowElem = null;
			});
		})();
		
		$.fn.getErrorMessage = function(){
			var message = '';
			var elem = this[0];
			if(elem){
				message = getContentValidationMessage(elem) || $.prop(elem, 'customValidationMessage') || $.prop(elem, 'validationMessage');
			}
			return message;
		};
		
		if(options.replaceValidationUI){
			if(options.overrideMessages && (options.customMessages || options.customMessages == null)){
				options.customMessages = true;
				options.overrideMessages = false;
				webshims.info("set overrideMessages to false. Use customMessages instead");
			}
			webshims.ready('DOM forms', function(){
				$(document).on('firstinvalid', function(e){
					if(!e.isInvalidUIPrevented()){
						e.preventDefault();
						$.webshims.validityAlert.showFor( e.target ); 
					}
				});
			});
		}
	});

})(jQuery);
(function($, Modernizr, webshims){
	"use strict";
	var hasNative = Modernizr.audio && Modernizr.video;
	var supportsLoop = false;
	var bugs = webshims.bugs;
	var swfType = 'mediaelement-jaris';
	var loadSwf = function(){
		webshims.ready(swfType, function(){
			if(!webshims.mediaelement.createSWF){
				webshims.mediaelement.loadSwf = true;
				webshims.reTest([swfType], hasNative);
			}
		});
	};
	var options = webshims.cfg.mediaelement;
	var hasFullTrackSupport;
	var hasSwf;
	if(!options){
		webshims.error("mediaelement wasn't implemented but loaded");
		return;
	}
	if(hasNative){
		var videoElem = document.createElement('video');
		Modernizr.videoBuffered = ('buffered' in videoElem);
		supportsLoop = ('loop' in videoElem);
		
		webshims.capturingEvents(['play', 'playing', 'waiting', 'paused', 'ended', 'durationchange', 'loadedmetadata', 'canplay', 'volumechange']);
		
		if(!Modernizr.videoBuffered){
			webshims.addPolyfill('mediaelement-native-fix', {
				f: 'mediaelement',
				test: Modernizr.videoBuffered,
				d: ['dom-support']
			});
			
			webshims.reTest('mediaelement-native-fix');
		}
	}
	
	if(hasNative && !options.preferFlash){
		var noSwitch = {
			1: 1,
			2: 1
		};
		var switchOptions = function(e){
			var media;
			var parent;
			if(!options.preferFlash && 
				($(e.target).is('audio, video') || ((parent = e.target.parentNode) && $('source:last', parent)[0] == e.target)) && 
				(media = $(e.target).closest('audio, video')) && !noSwitch[media.prop('error')]
				){
				$(function(){
					if(hasSwf && !options.preferFlash){
						loadSwf();
						webshims.ready('WINDOWLOAD '+swfType, function(){
							setTimeout(function(){
								if(!options.preferFlash && webshims.mediaelement.createSWF && !media.is('.nonnative-api-active')){
									options.preferFlash = true;
									document.removeEventListener('error', switchOptions, true);
									$('audio, video').each(function(){
										webshims.mediaelement.selectSource(this);
									});
									webshims.warn("switching mediaelements option to 'preferFlash', due to an error with native player: "+e.target.src+" Mediaerror: "+ media.prop('error'));
								}
							}, 9);
						});
					} else{
						document.removeEventListener('error', switchOptions, true);
					}
				});
			}
		};
		document.addEventListener('error', switchOptions, true);
		$('audio, video').each(function(){
			var error = $.prop(this, 'error');
			if(error && !noSwitch[error]){
				switchOptions({target: this});
				return false;
			}
		});
	}
	
	
	if(Modernizr.track && !bugs.track){
		(function(){
			
			if(!bugs.track){
				bugs.track = typeof $('<track />')[0].readyState != 'number';
			}
			
			if(!bugs.track){
				try {
					new TextTrackCue(2, 3, '');
				} catch(e){
					bugs.track = true;
				}
			}
			
			var trackOptions = webshims.cfg.track;
			var trackListener = function(e){
				$(e.target).filter('track').each(changeApi);
			};
			var changeApi = function(){
				if(bugs.track || (!trackOptions.override && $.prop(this, 'readyState') == 3)){
					trackOptions.override = true;
					webshims.reTest('track');
					document.removeEventListener('error', trackListener, true);
					if(this && $.nodeName(this, 'track')){
						webshims.error("track support was overwritten. Please check your vtt including your vtt mime-type");
					} else {
						webshims.info("track support was overwritten. due to bad browser support");
					}
					return false;
				}
			};
			var detectTrackError = function(){
				document.addEventListener('error', trackListener, true);
				
				if(bugs.track){
					changeApi();
				} else {
					$('track').each(changeApi);
				}
			};
			if(!trackOptions.override){
				if(webshims.isReady('track')){
					detectTrackError();
				} else {
					$(detectTrackError);
				}
			}
		})();
	}
	hasFullTrackSupport = Modernizr.track && !bugs.track;

webshims.register('mediaelement-core', function($, webshims, window, document, undefined){
	hasSwf = swfmini.hasFlashPlayerVersion('9.0.115');
	$('html').addClass(hasSwf ? 'swf' : 'no-swf');
	var mediaelement = webshims.mediaelement;
	mediaelement.parseRtmp = function(data){
		var src = data.src.split('://');
		var paths = src[1].split('/');
		var i, len, found;
		data.server = src[0]+'://'+paths[0]+'/';
		data.streamId = [];
		for(i = 1, len = paths.length; i < len; i++){
			if(!found && paths[i].indexOf(':') !== -1){
				paths[i] = paths[i].split(':')[1];
				found = true;
			}
			if(!found){
				data.server += paths[i]+'/';
			} else {
				data.streamId.push(paths[i]);
			}
		}
		if(!data.streamId.length){
			webshims.error('Could not parse rtmp url');
		}
		data.streamId = data.streamId.join('/');
	};
	var getSrcObj = function(elem, nodeName){
		elem = $(elem);
		var src = {src: elem.attr('src') || '', elem: elem, srcProp: elem.prop('src')};
		var tmp;
		
		if(!src.src){return src;}
		
		tmp = elem.attr('data-server');
		if(tmp != null){
			src.server = tmp;
		}
		
		tmp = elem.attr('type');
		if(tmp){
			src.type = tmp;
			src.container = $.trim(tmp.split(';')[0]);
		} else {
			if(!nodeName){
				nodeName = elem[0].nodeName.toLowerCase();
				if(nodeName == 'source'){
					nodeName = (elem.closest('video, audio')[0] || {nodeName: 'video'}).nodeName.toLowerCase();
				}
			}
			if(src.server){
				src.type = nodeName+'/rtmp';
				src.container = nodeName+'/rtmp';
			} else {
				
				tmp = mediaelement.getTypeForSrc( src.src, nodeName, src );
				
				if(tmp){
					src.type = tmp;
					src.container = tmp;
				}
			}
		}
		tmp = elem.attr('media');
		if(tmp){
			src.media = tmp;
		}
		if(src.type == 'audio/rtmp' || src.type == 'video/rtmp'){
			if(src.server){
				src.streamId = src.src;
			} else {
				mediaelement.parseRtmp(src);
			}
		}
		return src;
	};
	
	
	
	var hasYt = !hasSwf && ('postMessage' in window) && hasNative;
	
	var loadTrackUi = function(){
		if(loadTrackUi.loaded){return;}
		loadTrackUi.loaded = true;
		$(function(){
			webshims.loader.loadList(['track-ui']);
		});
	};
	var loadYt = (function(){
		var loaded;
		return function(){
			if(loaded || !hasYt){return;}
			loaded = true;
			webshims.loader.loadScript("https://www.youtube.com/player_api");
			$(function(){
				webshims._polyfill(["mediaelement-yt"]);
			});
		};
	})();
	var loadThird = function(){
		if(hasSwf){
			loadSwf();
		} else {
			loadYt();
		}
	};
	
	webshims.addPolyfill('mediaelement-yt', {
		test: !hasYt,
		d: ['dom-support']
	});
	
	mediaelement.mimeTypes = {
		audio: {
				//ogm shouldn´t be used!
				'audio/ogg': ['ogg','oga', 'ogm'],
				'audio/ogg;codecs="opus"': 'opus',
				'audio/mpeg': ['mp2','mp3','mpga','mpega'],
				'audio/mp4': ['mp4','mpg4', 'm4r', 'm4a', 'm4p', 'm4b', 'aac'],
				'audio/wav': ['wav'],
				'audio/3gpp': ['3gp','3gpp'],
				'audio/webm': ['webm'],
				'audio/fla': ['flv', 'f4a', 'fla'],
				'application/x-mpegURL': ['m3u8', 'm3u']
			},
			video: {
				//ogm shouldn´t be used!
				'video/ogg': ['ogg','ogv', 'ogm'],
				'video/mpeg': ['mpg','mpeg','mpe'],
				'video/mp4': ['mp4','mpg4', 'm4v'],
				'video/quicktime': ['mov','qt'],
				'video/x-msvideo': ['avi'],
				'video/x-ms-asf': ['asf', 'asx'],
				'video/flv': ['flv', 'f4v'],
				'video/3gpp': ['3gp','3gpp'],
				'video/webm': ['webm'],
				'application/x-mpegURL': ['m3u8', 'm3u'],
				'video/MP2T': ['ts']
			}
		}
	;
	
	mediaelement.mimeTypes.source =  $.extend({}, mediaelement.mimeTypes.audio, mediaelement.mimeTypes.video);
	
	mediaelement.getTypeForSrc = function(src, nodeName, data){
		if(src.indexOf('youtube.com/watch?') != -1 || src.indexOf('youtube.com/v/') != -1){
			return 'video/youtube';
		}
		if(src.indexOf('rtmp') === 0){
			return nodeName+'/rtmp';
		}
		src = src.split('?')[0].split('.');
		src = src[src.length - 1];
		var mt;
		
		$.each(mediaelement.mimeTypes[nodeName], function(mimeType, exts){
			if(exts.indexOf(src) !== -1){
				mt = mimeType;
				return false;
			}
		});
		return mt;
	};
	
	
	mediaelement.srces = function(mediaElem, srces){
		mediaElem = $(mediaElem);
		if(!srces){
			srces = [];
			var nodeName = mediaElem[0].nodeName.toLowerCase();
			var src = getSrcObj(mediaElem, nodeName);
			
			if(!src.src){
				
				$('source', mediaElem).each(function(){
					src = getSrcObj(this, nodeName);
					if(src.src){srces.push(src);}
				});
			} else {
				srces.push(src);
			}
			return srces;
		} else {
			mediaElem.removeAttr('src').removeAttr('type').find('source').remove();
			if(!$.isArray(srces)){
				srces = [srces]; 
			}
			srces.forEach(function(src){
				var source = document.createElement('source');
				if(typeof src == 'string'){
					src = {src: src};
				} 
				source.setAttribute('src', src.src);
				if(src.type){
					source.setAttribute('type', src.type);
				}
				if(src.media){
					source.setAttribute('media', src.media);
				}
				mediaElem.append(source);
			});
			
		}
	};
	
	
	$.fn.loadMediaSrc = function(srces, poster){
		return this.each(function(){
			if(poster !== undefined){
				$(this).removeAttr('poster');
				if(poster){
					$.attr(this, 'poster', poster);
				}
			}
			mediaelement.srces(this, srces);
			$(this).mediaLoad();
		});
	};
	
	mediaelement.swfMimeTypes = ['video/3gpp', 'video/x-msvideo', 'video/quicktime', 'video/x-m4v', 'video/mp4', 'video/m4p', 'video/x-flv', 'video/flv', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/mp3', 'audio/x-fla', 'audio/fla', 'youtube/flv', 'video/jarisplayer', 'jarisplayer/jarisplayer', 'video/youtube', 'video/rtmp', 'audio/rtmp'];
	
	mediaelement.canThirdPlaySrces = function(mediaElem, srces){
		var ret = '';
		if(hasSwf || hasYt){
			mediaElem = $(mediaElem);
			srces = srces || mediaelement.srces(mediaElem);
			$.each(srces, function(i, src){
				if(src.container && src.src && ((hasSwf && mediaelement.swfMimeTypes.indexOf(src.container) != -1) || (hasYt && src.container == 'video/youtube'))){
					ret = src;
					return false;
				}
			});
			
		}
		
		return ret;
	};
	
	var nativeCanPlayType = {};
	mediaelement.canNativePlaySrces = function(mediaElem, srces){
		var ret = '';
		if(hasNative){
			mediaElem = $(mediaElem);
			var nodeName = (mediaElem[0].nodeName || '').toLowerCase();
			var nativeCanPlay = (nativeCanPlayType[nodeName] || {prop: {_supvalue: false}}).prop._supvalue || mediaElem[0].canPlayType;
			if(!nativeCanPlay){return ret;}
			srces = srces || mediaelement.srces(mediaElem);
			
			$.each(srces, function(i, src){
				if(src.type && nativeCanPlay.call(mediaElem[0], src.type) ){
					ret = src;
					return false;
				}
			});
		}
		return ret;
	};
	var emptyType = (/^\s*application\/octet\-stream\s*$/i);
	var getRemoveEmptyType = function(){
		var ret = emptyType.test($.attr(this, 'type') || '');
		if(ret){
			$(this).removeAttr('type');
		}
		return ret;
	};
	mediaelement.setError = function(elem, message){
		if($('source', elem).filter(getRemoveEmptyType).length){
			webshims.error('"application/octet-stream" is a useless mimetype for audio/video. Please change this attribute.');
			try {
				$(elem).mediaLoad();
			} catch(er){}
		} else {
			if(!message){
				message = "can't play sources";
			}
			$(elem).pause().data('mediaerror', message);
			webshims.error('mediaelementError: '+ message);
			setTimeout(function(){
				if($(elem).data('mediaerror')){
					$(elem).trigger('mediaerror');
				}
			}, 1);
		}
		
		
	};
	
	var handleThird = (function(){
		var requested;
		return function( mediaElem, ret, data ){
			if(!requested){
				loadTrackUi();
			}
			webshims.ready(hasSwf ? swfType : 'mediaelement-yt', function(){
				if(mediaelement.createSWF){
					mediaelement.createSWF( mediaElem, ret, data );
				} else if(!requested) {
					requested = true;
					loadThird();
					//readd to ready
					handleThird( mediaElem, ret, data );
				}
			});
			if(!requested && hasYt && !mediaelement.createSWF){
				loadYt();
			}
		};
	})();
	
	var stepSources = function(elem, data, useSwf, _srces, _noLoop){
		var ret;
		if(useSwf || (useSwf !== false && data && data.isActive == 'third')){
			ret = mediaelement.canThirdPlaySrces(elem, _srces);
			if(!ret){
				if(_noLoop){
					mediaelement.setError(elem, false);
				} else {
					stepSources(elem, data, false, _srces, true);
				}
			} else {
				handleThird(elem, ret, data);
			}
		} else {
			ret = mediaelement.canNativePlaySrces(elem, _srces);
			if(!ret){
				if(_noLoop){
					mediaelement.setError(elem, false);
					if(data && data.isActive == 'third') {
						mediaelement.setActive(elem, 'html5', data);
					}
				} else {
					stepSources(elem, data, true, _srces, true);
				}
			} else if(data && data.isActive == 'third') {
				mediaelement.setActive(elem, 'html5', data);
			}
		}
	};
	var stopParent = /^(?:embed|object|datalist)$/i;
	var selectSource = function(elem, data){
		var baseData = webshims.data(elem, 'mediaelementBase') || webshims.data(elem, 'mediaelementBase', {});
		var _srces = mediaelement.srces(elem);
		var parent = elem.parentNode;
		
		clearTimeout(baseData.loadTimer);
		$.data(elem, 'mediaerror', false);
		
		if(!_srces.length || !parent || parent.nodeType != 1 || stopParent.test(parent.nodeName || '')){return;}
		data = data || webshims.data(elem, 'mediaelement');
		stepSources(elem, data, options.preferFlash || undefined, _srces);
	};
	mediaelement.selectSource = selectSource;
	
	
	$(document).on('ended', function(e){
		var data = webshims.data(e.target, 'mediaelement');
		if( supportsLoop && (!data || data.isActive == 'html5') && !$.prop(e.target, 'loop')){return;}
		setTimeout(function(){
			if( $.prop(e.target, 'paused') || !$.prop(e.target, 'loop') ){return;}
			$(e.target).prop('currentTime', 0).play();
		}, 1);
		
	});
	
	webshims.ready('dom-support', function(){
		if(!supportsLoop){
			webshims.defineNodeNamesBooleanProperty(['audio', 'video'], 'loop');
		}
		
		['audio', 'video'].forEach(function(nodeName){
			var supLoad = webshims.defineNodeNameProperty(nodeName, 'load',  {
				prop: {
					value: function(){
						var data = webshims.data(this, 'mediaelement');
						selectSource(this, data);
						if(hasNative && (!data || data.isActive == 'html5') && supLoad.prop._supvalue){
							supLoad.prop._supvalue.apply(this, arguments);
						}
					}
				}
			});
			nativeCanPlayType[nodeName] = webshims.defineNodeNameProperty(nodeName, 'canPlayType',  {
				prop: {
					value: function(type){
						var ret = '';
						if(hasNative && nativeCanPlayType[nodeName].prop._supvalue){
							ret = nativeCanPlayType[nodeName].prop._supvalue.call(this, type);
							if(ret == 'no'){
								ret = '';
							}
						}
						if(!ret && hasSwf){
							type = $.trim((type || '').split(';')[0]);
							if(mediaelement.swfMimeTypes.indexOf(type) != -1){
								ret = 'maybe';
							}
						}
						return ret;
					}
				}
			});
		});
		webshims.onNodeNamesPropertyModify(['audio', 'video'], ['src', 'poster'], {
			set: function(){
				var elem = this;
				var baseData = webshims.data(elem, 'mediaelementBase') || webshims.data(elem, 'mediaelementBase', {});
				clearTimeout(baseData.loadTimer);
				baseData.loadTimer = setTimeout(function(){
					selectSource(elem);
					elem = null;
				}, 9);
			}
		});
	});
		
	var initMediaElements = function(){
		var testFixMedia = function(){
			if(webshims.implement(this, 'mediaelement')){
				selectSource(this);
				
				if(hasNative){
					var bufferTimer;
					var lastBuffered;
					var elem = this;
					var getBufferedString = function(){
						var buffered = $.prop(elem, 'buffered');
						if(!buffered){return;}
						var bufferString = "";
						for(var i = 0, len = buffered.length; i < len;i++){
							bufferString += buffered.end(i);
						}
						return bufferString;
					};
					var testBuffer = function(){
						var buffered = getBufferedString();
						if(buffered != lastBuffered){
							lastBuffered = buffered;
							$(elem).triggerHandler('progress');
						}
					};
					
					$(this)
						.on({
							'play loadstart progress': function(e){
								if(e.type == 'progress'){
									lastBuffered = getBufferedString();
								}
								clearTimeout(bufferTimer);
								bufferTimer = setTimeout(testBuffer, 999);
							},
							'emptied stalled mediaerror abort suspend': function(e){
								if(e.type == 'emptied'){
									lastBuffered = false;
								}
								clearTimeout(bufferTimer);
							}
						})
					;
					if('ActiveXObject' in window && $.prop(this, 'paused') && !$.prop(this, 'readyState') && $(this).is('audio[preload="none"][controls]:not([autoplay],.nonnative-api-active)')){
						$(this).prop('preload', 'metadata').mediaLoad(); 
					}
				}
			}
			
		};
		var handleMedia = false;
		
		
		webshims.ready('dom-support', function(){
			handleMedia = true;
			webshims.addReady(function(context, insertedElement){
				var media = $('video, audio', context)
					.add(insertedElement.filter('video, audio'))
					.each(testFixMedia)
				;
				if(!loadTrackUi.loaded && $('track', media).length){
					loadTrackUi();
				}
				media = null;
			});
		});
		
		if(hasNative && !handleMedia){
			webshims.addReady(function(context, insertedElement){
				if(!handleMedia){
					$('video, audio', context)
						.add(insertedElement.filter('video, audio'))
						.each(function(){
							if((!hasFullTrackSupport || webshims.modules.track.options.override) && !loadTrackUi.loaded && $('track', this).length){
								loadTrackUi();
							}
							if(!mediaelement.canNativePlaySrces(this)){
								loadThird();
								handleMedia = true;
								return false;
							}
						})
					;
				}
			});
		}
	};
	
	if(hasFullTrackSupport){
		webshims.defineProperty(TextTrack.prototype, 'shimActiveCues', {
			get: function(){
				return this._shimActiveCues || this.activeCues;
			}
		});
	}
	//set native implementation ready, before swf api is retested
	if(hasNative){
		webshims.isReady('mediaelement-core', true);
		initMediaElements();
		webshims.ready('WINDOWLOAD mediaelement', loadThird);
	} else {
		webshims.ready(swfType, initMediaElements);
	}
	webshims.ready('WINDOWLOAD mediaelement', loadTrackUi);
});
})(jQuery, Modernizr, jQuery.webshims);