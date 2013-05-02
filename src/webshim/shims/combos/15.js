//DOM-Extension helper
jQuery.webshims.register('dom-extend', function($, webshims, window, document, undefined){
	"use strict";
	
	webshims.assumeARIA = $.support.getSetAttribute || Modernizr.canvas || Modernizr.video || Modernizr.boxsizing;
	
	if($('<input type="email" />').attr('type') == 'text' || $('<form />').attr('novalidate') === "" || ('required' in $('<input />')[0].attributes)){
		webshims.error("IE browser modes are busted in IE10. Please test your HTML/CSS/JS with a real IE version or at least IETester or similiar tools");
	}
	
	if(!$.parseHTML){
		webshims.error("Webshims needs jQuery 1.8+ to work properly. Please update your jQuery version or downgrade webshims.");
	}
	
//	(function(){
//		var hostNames = {
//			'afarkas.github.io': 1,
//			localhost: 1,
//			'127.0.0.1': 1
//		};
//		
//		if( webshims.debug && (hostNames[location.hostname] || location.protocol == 'file:') ){
//			var list = $('<ul class="webshims-debug-list" />');
//			webshims.errorLog.push = function(message){
//				list.appendTo('body');
//				$('<li style="display: none;">'+ message +'</li>')
//					.appendTo(list)
//					.slideDown()
//					.delay(3000)
//					.slideUp(function(){
//						$(this).remove();
//						if(!$('li', list).length){
//							list.detach();
//						}
//					})
//				;
//			};
//			$.each(webshims.errorLog, function(i, message){
//				webshims.errorLog.push(message);
//			});
//		}
//	})();

	//shortcus
	var modules = webshims.modules;
	var listReg = /\s*,\s*/;
		
	//proxying attribute
	var olds = {};
	var havePolyfill = {};
	var extendedProps = {};
	var extendQ = {};
	var modifyProps = {};
	
	var oldVal = $.fn.val;
	var singleVal = function(elem, name, val, pass, _argless){
		return (_argless) ? oldVal.call($(elem)) : oldVal.call($(elem), val);
	};
	
	//jquery mobile and jquery ui
	if(!$.widget){
		(function(){
			var _cleanData = $.cleanData;
			$.cleanData = function( elems ) {
				if(!$.widget){
					for ( var i = 0, elem; (elem = elems[i]) != null; i++ ) {
						try {
							$( elem ).triggerHandler( "remove" );
						// http://bugs.jquery.com/ticket/8235
						} catch( e ) {}
					}
				}
				_cleanData( elems );
			};
		})();
	}
	

	$.fn.val = function(val){
		var elem = this[0];
		if(arguments.length && val == null){
			val = '';
		}
		if(!arguments.length){
			if(!elem || elem.nodeType !== 1){return oldVal.call(this);}
			return $.prop(elem, 'value', val, 'val', true);
		}
		if($.isArray(val)){
			return oldVal.apply(this, arguments);
		}
		var isFunction = $.isFunction(val);
		return this.each(function(i){
			elem = this;
			if(elem.nodeType === 1){
				if(isFunction){
					var genVal = val.call( elem, i, $.prop(elem, 'value', undefined, 'val', true));
					if(genVal == null){
						genVal = '';
					}
					$.prop(elem, 'value', genVal, 'val') ;
				} else {
					$.prop(elem, 'value', val, 'val');
				}
			}
		});
	};
	$.fn.onTrigger = function(evt, fn){
		return this.on(evt, fn).each(fn);
	};
	
	$.fn.onWSOff = function(evt, fn, trigger){
		$(document)[trigger ? 'onTrigger' : 'on'](evt, fn);
		this.on('remove', function(e){
			if(!e.originalEvent){
				$(document).off(evt, fn);
			}
		});
	};
	
	var dataID = '_webshimsLib'+ (Math.round(Math.random() * 1000));
	var elementData = function(elem, key, val){
		elem = elem.jquery ? elem[0] : elem;
		if(!elem){return val || {};}
		var data = $.data(elem, dataID);
		if(val !== undefined){
			if(!data){
				data = $.data(elem, dataID, {});
			}
			if(key){
				data[key] = val;
			}
		}
		
		return key ? data && data[key] : data;
	};


	[{name: 'getNativeElement', prop: 'nativeElement'}, {name: 'getShadowElement', prop: 'shadowElement'}, {name: 'getShadowFocusElement', prop: 'shadowFocusElement'}].forEach(function(data){
		$.fn[data.name] = function(){
			var elems = [];
			this.each(function(){
				var shadowData = elementData(this, 'shadowData');
				var elem = shadowData && shadowData[data.prop] || this;
				if($.inArray(elem, elems) == -1){
					elems.push(elem);
				}
			});
			return this.pushStack(elems);
		};
	});
	
	if($.Tween.propHooks._default && $.css){
		(function(){
			var isjQ8 = false;
			try {
				isjQ8 = $.css($('<b style="width: 10px" />')[0], 'width', '') == '10px';
			} catch(er){
				webshims.error(er);
			}
			var css = isjQ8 ? 
				function(elem, prop){
					return $.css( elem, prop, false, "" );
				} :
				function(elem, prop){
					return $.css( elem, prop, "" );
				}
			;
				
			$.extend($.Tween.propHooks._default, {
				get: function( tween ) {
					var result;
					
					if ( (tween.elem[ tween.prop ] != null || havePolyfill[ tween.prop ]) &&
						(!tween.elem.style || tween.elem.style[ tween.prop ] == null) ) {
						return havePolyfill[ tween.prop ] ? $.prop(tween.elem, tween.prop) : tween.elem[ tween.prop ];
					}
		
					// passing an empty string as a 3rd parameter to .css will automatically
					// attempt a parseFloat and fallback to a string if the parse fails
					// so, simple values such as "10px" are parsed to Float.
					// complex values such as "rotate(1rad)" are returned as is.
					result = css( tween.elem, tween.prop );
					// Empty strings, null, undefined and "auto" are converted to 0.
					return !result || result === "auto" ? 0 : result;
				},
				set: function( tween ) {
					// use step hook for back compat - use cssHook if its there - use .style if its
					// available and use plain properties where available
					if ( jQuery.fx.step[ tween.prop ] ) {
						jQuery.fx.step[ tween.prop ]( tween );
					} else if ( tween.elem.style && ( tween.elem.style[ jQuery.cssProps[ tween.prop ] ] != null || jQuery.cssHooks[ tween.prop ] ) ) {
						jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
					} else if( !havePolyfill[ tween.prop ] ) {
						tween.elem[ tween.prop ] = tween.now;
					} else {
						$.prop(tween.elem, tween.prop, tween.now);
					}
				}
			});
		})();
	}
	
	
	['removeAttr', 'prop', 'attr'].forEach(function(type){
		olds[type] = $[type];
		$[type] = function(elem, name, value, pass, _argless){
			var isVal = (pass == 'val');
			var oldMethod = !isVal ? olds[type] : singleVal;
			if( !elem || !havePolyfill[name] || elem.nodeType !== 1 || (!isVal && pass && type == 'attr' && $.attrFn[name]) ){
				return oldMethod(elem, name, value, pass, _argless);
			}
			
			var nodeName = (elem.nodeName || '').toLowerCase();
			var desc = extendedProps[nodeName];
			var curType = (type == 'attr' && (value === false || value === null)) ? 'removeAttr' : type;
			var propMethod;
			var oldValMethod;
			var ret;
			
			
			if(!desc){
				desc = extendedProps['*'];
			}
			if(desc){
				desc = desc[name];
			}
			
			if(desc){
				propMethod = desc[curType];
			}
			
			if(propMethod){
				if(name == 'value'){
					oldValMethod = propMethod.isVal;
					propMethod.isVal = isVal;
				}
				if(curType === 'removeAttr'){
					return propMethod.value.call(elem);	
				} else if(value === undefined){
					return (propMethod.get) ? 
						propMethod.get.call(elem) : 
						propMethod.value
					;
				} else if(propMethod.set) {
					if(type == 'attr' && value === true){
						value = name;
					}
					
					ret = propMethod.set.call(elem, value);
				}
				if(name == 'value'){
					propMethod.isVal = oldValMethod;
				}
			} else {
				ret = oldMethod(elem, name, value, pass, _argless);
			}
			if((value !== undefined || curType === 'removeAttr') && modifyProps[nodeName] && modifyProps[nodeName][name]){
				
				var boolValue;
				if(curType == 'removeAttr'){
					boolValue = false;
				} else if(curType == 'prop'){
					boolValue = !!(value);
				} else {
					boolValue = true;
				}
				
				modifyProps[nodeName][name].forEach(function(fn){
					if(!fn.only || (fn.only = 'prop' && type == 'prop') || (fn.only == 'attr' && type != 'prop')){
						fn.call(elem, value, boolValue, (isVal) ? 'val' : curType, type);
					}
				});
			}
			return ret;
		};
		
		extendQ[type] = function(nodeName, prop, desc){
			
			if(!extendedProps[nodeName]){
				extendedProps[nodeName] = {};
			}
			if(!extendedProps[nodeName][prop]){
				extendedProps[nodeName][prop] = {};
			}
			var oldDesc = extendedProps[nodeName][prop][type];
			var getSup = function(propType, descriptor, oDesc){
				if(descriptor && descriptor[propType]){
					return descriptor[propType];
				}
				if(oDesc && oDesc[propType]){
					return oDesc[propType];
				}
				if(type == 'prop' && prop == 'value'){
					return function(value){
						var elem = this;
						return (desc.isVal) ? 
							singleVal(elem, prop, value, false, (arguments.length === 0)) : 
							olds[type](elem, prop, value)
						;
					};
				}
				if(type == 'prop' && propType == 'value' && desc.value.apply){
					return  function(value){
						var sup = olds[type](this, prop);
						if(sup && sup.apply){
							sup = sup.apply(this, arguments);
						} 
						return sup;
					};
				}
				return function(value){
					return olds[type](this, prop, value);
				};
			};
			extendedProps[nodeName][prop][type] = desc;
			if(desc.value === undefined){
				if(!desc.set){
					desc.set = desc.writeable ? 
						getSup('set', desc, oldDesc) : 
						(webshims.cfg.useStrict && prop == 'prop') ? 
							function(){throw(prop +' is readonly on '+ nodeName);} : 
							function(){webshims.info(prop +' is readonly on '+ nodeName);}
					;
				}
				if(!desc.get){
					desc.get = getSup('get', desc, oldDesc);
				}
				
			}
			
			['value', 'get', 'set'].forEach(function(descProp){
				if(desc[descProp]){
					desc['_sup'+descProp] = getSup(descProp, oldDesc);
				}
			});
		};
		
	});
	
	var extendNativeValue = (function(){
		var UNKNOWN = webshims.getPrototypeOf(document.createElement('foobar'));
		var has = Object.prototype.hasOwnProperty;
		//see also: https://github.com/lojjic/PIE/issues/40 | https://prototype.lighthouseapp.com/projects/8886/tickets/1107-ie8-fatal-crash-when-prototypejs-is-loaded-with-rounded-cornershtc
		var isExtendNativeSave = Modernizr.advancedObjectProperties && Modernizr.objectAccessor;
		return function(nodeName, prop, desc){
			var elem , elemProto;
			 if( isExtendNativeSave && (elem = document.createElement(nodeName)) && (elemProto = webshims.getPrototypeOf(elem)) && UNKNOWN !== elemProto && ( !elem[prop] || !has.call(elem, prop) ) ){
				var sup = elem[prop];
				desc._supvalue = function(){
					if(sup && sup.apply){
						return sup.apply(this, arguments);
					}
					return sup;
				};
				elemProto[prop] = desc.value;
			} else {
				desc._supvalue = function(){
					var data = elementData(this, 'propValue');
					if(data && data[prop] && data[prop].apply){
						return data[prop].apply(this, arguments);
					}
					return data && data[prop];
				};
				initProp.extendValue(nodeName, prop, desc.value);
			}
			desc.value._supvalue = desc._supvalue;
		};
	})();
		
	var initProp = (function(){
		
		var initProps = {};
		
		webshims.addReady(function(context, contextElem){
			var nodeNameCache = {};
			var getElementsByName = function(name){
				if(!nodeNameCache[name]){
					nodeNameCache[name] = $(context.getElementsByTagName(name));
					if(contextElem[0] && $.nodeName(contextElem[0], name)){
						nodeNameCache[name] = nodeNameCache[name].add(contextElem);
					}
				}
			};
			
			
			$.each(initProps, function(name, fns){
				getElementsByName(name);
				if(!fns || !fns.forEach){
					webshims.warn('Error: with '+ name +'-property. methods: '+ fns);
					return;
				}
				fns.forEach(function(fn){
					nodeNameCache[name].each(fn);
				});
			});
			nodeNameCache = null;
		});
		
		var tempCache;
		var emptyQ = $([]);
		var createNodeNameInit = function(nodeName, fn){
			if(!initProps[nodeName]){
				initProps[nodeName] = [fn];
			} else {
				initProps[nodeName].push(fn);
			}
			if($.isDOMReady){
				(tempCache || $( document.getElementsByTagName(nodeName) )).each(fn);
			}
		};
		
		var elementExtends = {};
		return {
			createTmpCache: function(nodeName){
				if($.isDOMReady){
					tempCache = tempCache || $( document.getElementsByTagName(nodeName) );
				}
				return tempCache || emptyQ;
			},
			flushTmpCache: function(){
				tempCache = null;
			},
			content: function(nodeName, prop){
				createNodeNameInit(nodeName, function(){
					var val =  $.attr(this, prop);
					if(val != null){
						$.attr(this, prop, val);
					}
				});
			},
			createElement: function(nodeName, fn){
				createNodeNameInit(nodeName, fn);
			},
			extendValue: function(nodeName, prop, value){
				createNodeNameInit(nodeName, function(){
					$(this).each(function(){
						var data = elementData(this, 'propValue', {});
						data[prop] = this[prop];
						this[prop] = value;
					});
				});
			}
		};
	})();
		
	var createPropDefault = function(descs, removeType){
		if(descs.defaultValue === undefined){
			descs.defaultValue = '';
		}
		if(!descs.removeAttr){
			descs.removeAttr = {
				value: function(){
					descs[removeType || 'prop'].set.call(this, descs.defaultValue);
					descs.removeAttr._supvalue.call(this);
				}
			};
		}
		if(!descs.attr){
			descs.attr = {};
		}
	};
	
	$.extend(webshims, {

		getID: (function(){
			var ID = new Date().getTime();
			return function(elem){
				elem = $(elem);
				var id = elem.prop('id');
				if(!id){
					ID++;
					id = 'ID-'+ ID;
					elem.eq(0).prop('id', id);
				}
				return id;
			};
		})(),
		implement: function(elem, type){
			var data = elementData(elem, 'implemented') || elementData(elem, 'implemented', {});
			if(data[type]){
				webshims.warn(type +' already implemented for element #'+elem.id);
				return false;
			}
			data[type] = true;
			return true;
		},
		extendUNDEFProp: function(obj, props){
			$.each(props, function(name, prop){
				if( !(name in obj) ){
					obj[name] = prop;
				}
			});
		},
		//http://www.w3.org/TR/html5/common-dom-interfaces.html#reflect
		createPropDefault: createPropDefault,
		data: elementData,
		moveToFirstEvent: function(elem, eventType, bindType){
			var events = ($._data(elem, 'events') || {})[eventType];
			var fn;
			
			if(events && events.length > 1){
				fn = events.pop();
				if(!bindType){
					bindType = 'bind';
				}
				if(bindType == 'bind' && events.delegateCount){
					events.splice( events.delegateCount, 0, fn);
				} else {
					events.unshift( fn );
				}
				
				
			}
			elem = null;
		},
		addShadowDom: (function(){
			var resizeTimer;
			var lastHeight;
			var lastWidth;
			
			var docObserve = {
				init: false,
				runs: 0,
				test: function(){
					var height = docObserve.getHeight();
					var width = docObserve.getWidth();
					
					if(height != docObserve.height || width != docObserve.width){
						docObserve.height = height;
						docObserve.width = width;
						docObserve.handler({type: 'docresize'});
						docObserve.runs++;
						if(docObserve.runs < 9){
							setTimeout(docObserve.test, 90);
						}
					} else {
						docObserve.runs = 0;
					}
				},
				handler: function(e){
					clearTimeout(resizeTimer);
					resizeTimer = setTimeout(function(){
						if(e.type == 'resize'){
							var width = $(window).width();
							var height = $(window).width();
							if(height == lastHeight && width == lastWidth){
								return;
							}
							lastHeight = height;
							lastWidth = width;
							
							docObserve.height = docObserve.getHeight();
							docObserve.width = docObserve.getWidth();
							
						}
						$(document).triggerHandler('updateshadowdom');
					}, (e.type == 'resize') ? 50 : 9);
				},
				_create: function(){
					$.each({ Height: "getHeight", Width: "getWidth" }, function(name, type){
						var body = document.body;
						var doc = document.documentElement;
						docObserve[type] = function(){
							return Math.max(
								body[ "scroll" + name ], doc[ "scroll" + name ],
								body[ "offset" + name ], doc[ "offset" + name ],
								doc[ "client" + name ]
							);
						};
					});
				},
				start: function(){
					if(!this.init && document.body){
						this.init = true;
						this._create();
						this.height = docObserve.getHeight();
						this.width = docObserve.getWidth();
						setInterval(this.test, 600);
						$(this.test);
						webshims.ready('WINDOWLOAD', this.test);
						$(window).bind('resize', this.handler);
						(function(){
							var oldAnimate = $.fn.animate;
							var animationTimer;
							
							$.fn.animate = function(){
								clearTimeout(animationTimer);
								animationTimer = setTimeout(function(){
									docObserve.test();
								}, 99);
								
								return oldAnimate.apply(this, arguments);
							};
						})();
					}
				}
			};
			
			
			webshims.docObserve = function(){
				webshims.ready('DOM', function(){
					docObserve.start();
				});
			};
			return function(nativeElem, shadowElem, opts){
				opts = opts || {};
				if(nativeElem.jquery){
					nativeElem = nativeElem[0];
				}
				if(shadowElem.jquery){
					shadowElem = shadowElem[0];
				}
				var nativeData = $.data(nativeElem, dataID) || $.data(nativeElem, dataID, {});
				var shadowData = $.data(shadowElem, dataID) || $.data(shadowElem, dataID, {});
				var shadowFocusElementData = {};
				if(!opts.shadowFocusElement){
					opts.shadowFocusElement = shadowElem;
				} else if(opts.shadowFocusElement){
					if(opts.shadowFocusElement.jquery){
						opts.shadowFocusElement = opts.shadowFocusElement[0];
					}
					shadowFocusElementData = $.data(opts.shadowFocusElement, dataID) || $.data(opts.shadowFocusElement, dataID, shadowFocusElementData);
				}
				
				nativeData.hasShadow = shadowElem;
				shadowFocusElementData.nativeElement = shadowData.nativeElement = nativeElem;
				shadowFocusElementData.shadowData = shadowData.shadowData = nativeData.shadowData = {
					nativeElement: nativeElem,
					shadowElement: shadowElem,
					shadowFocusElement: opts.shadowFocusElement
				};
				if(opts.shadowChilds){
					opts.shadowChilds.each(function(){
						elementData(this, 'shadowData', shadowData.shadowData);
					});
				}
				
				if(opts.data){
					shadowFocusElementData.shadowData.data = shadowData.shadowData.data = nativeData.shadowData.data = opts.data;
				}
				opts = null;
				webshims.docObserve();
			};
		})(),
		propTypes: {
			standard: function(descs, name){
				createPropDefault(descs);
				if(descs.prop){return;}
				descs.prop = {
					set: function(val){
						descs.attr.set.call(this, ''+val);
					},
					get: function(){
						return descs.attr.get.call(this) || descs.defaultValue;
					}
				};
				
			},
			"boolean": function(descs, name){
				
				createPropDefault(descs);
				if(descs.prop){return;}
				descs.prop = {
					set: function(val){
						if(val){
							descs.attr.set.call(this, "");
						} else {
							descs.removeAttr.value.call(this);
						}
					},
					get: function(){
						return descs.attr.get.call(this) != null;
					}
				};
			},
			"src": (function(){
				var anchor = document.createElement('a');
				anchor.style.display = "none";
				return function(descs, name){
					
					createPropDefault(descs);
					if(descs.prop){return;}
					descs.prop = {
						set: function(val){
							descs.attr.set.call(this, val);
						},
						get: function(){
							var href = this.getAttribute(name);
							var ret;
							if(href == null){return '';}
							
							anchor.setAttribute('href', href+'' );
							
							if(!$.support.hrefNormalized){
								try {
									$(anchor).insertAfter(this);
									ret = anchor.getAttribute('href', 4);
								} catch(er){
									ret = anchor.getAttribute('href', 4);
								}
								$(anchor).detach();
							}
							return ret || anchor.href;
						}
					};
				};
			})(),
			enumarated: function(descs, name){
					
					createPropDefault(descs);
					if(descs.prop){return;}
					descs.prop = {
						set: function(val){
							descs.attr.set.call(this, val);
						},
						get: function(){
							var val = (descs.attr.get.call(this) || '').toLowerCase();
							if(!val || descs.limitedTo.indexOf(val) == -1){
								val = descs.defaultValue;
							}
							return val;
						}
					};
				}
			
//			,unsignedLong: $.noop
//			,"doubble": $.noop
//			,"long": $.noop
//			,tokenlist: $.noop
//			,settableTokenlist: $.noop
		},
		reflectProperties: function(nodeNames, props){
			if(typeof props == 'string'){
				props = props.split(listReg);
			}
			props.forEach(function(prop){
				webshims.defineNodeNamesProperty(nodeNames, prop, {
					prop: {
						set: function(val){
							$.attr(this, prop, val);
						},
						get: function(){
							return $.attr(this, prop) || '';
						}
					}
				});
			});
		},
		defineNodeNameProperty: function(nodeName, prop, descs){
			havePolyfill[prop] = true;
						
			if(descs.reflect){
				webshims.propTypes[descs.propType || 'standard'](descs, prop);
			}
			
			['prop', 'attr', 'removeAttr'].forEach(function(type){
				var desc = descs[type];
				if(desc){
					if(type === 'prop'){
						desc = $.extend({writeable: true}, desc);
					} else {
						desc = $.extend({}, desc, {writeable: true});
					}
						
					extendQ[type](nodeName, prop, desc);
					if(nodeName != '*' && webshims.cfg.extendNative && type == 'prop' && desc.value && $.isFunction(desc.value)){
						extendNativeValue(nodeName, prop, desc);
					}
					descs[type] = desc;
				}
			});
			if(descs.initAttr){
				initProp.content(nodeName, prop);
			}
			return descs;
		},
		
		defineNodeNameProperties: function(name, descs, propType, _noTmpCache){
			var olddesc;
			for(var prop in descs){
				if(!_noTmpCache && descs[prop].initAttr){
					initProp.createTmpCache(name);
				}
				if(propType){
					if(descs[prop][propType]){
						//webshims.log('override: '+ name +'['+prop +'] for '+ propType);
					} else {
						descs[prop][propType] = {};
						['value', 'set', 'get'].forEach(function(copyProp){
							if(copyProp in descs[prop]){
								descs[prop][propType][copyProp] = descs[prop][copyProp];
								delete descs[prop][copyProp];
							}
						});
					}
				}
				descs[prop] = webshims.defineNodeNameProperty(name, prop, descs[prop]);
			}
			if(!_noTmpCache){
				initProp.flushTmpCache();
			}
			return descs;
		},
		
		createElement: function(nodeName, create, descs){
			var ret;
			if($.isFunction(create)){
				create = {
					after: create
				};
			}
			initProp.createTmpCache(nodeName);
			if(create.before){
				initProp.createElement(nodeName, create.before);
			}
			if(descs){
				ret = webshims.defineNodeNameProperties(nodeName, descs, false, true);
			}
			if(create.after){
				initProp.createElement(nodeName, create.after);
			}
			initProp.flushTmpCache();
			return ret;
		},
		onNodeNamesPropertyModify: function(nodeNames, props, desc, only){
			if(typeof nodeNames == 'string'){
				nodeNames = nodeNames.split(listReg);
			}
			if($.isFunction(desc)){
				desc = {set: desc};
			}
			
			nodeNames.forEach(function(name){
				if(!modifyProps[name]){
					modifyProps[name] = {};
				}
				if(typeof props == 'string'){
					props = props.split(listReg);
				}
				if(desc.initAttr){
					initProp.createTmpCache(name);
				}
				props.forEach(function(prop){
					if(!modifyProps[name][prop]){
						modifyProps[name][prop] = [];
						havePolyfill[prop] = true;
					}
					if(desc.set){
						if(only){
							desc.set.only =  only;
						}
						modifyProps[name][prop].push(desc.set);
					}
					
					if(desc.initAttr){
						initProp.content(name, prop);
					}
				});
				initProp.flushTmpCache();
				
			});
		},
		defineNodeNamesBooleanProperty: function(elementNames, prop, descs){
			if(!descs){
				descs = {};
			}
			if($.isFunction(descs)){
				descs.set = descs;
			}
			webshims.defineNodeNamesProperty(elementNames, prop, {
				attr: {
					set: function(val){
						this.setAttribute(prop, val);
						if(descs.set){
							descs.set.call(this, true);
						}
					},
					get: function(){
						var ret = this.getAttribute(prop);
						return (ret == null) ? undefined : prop;
					}
				},
				removeAttr: {
					value: function(){
						this.removeAttribute(prop);
						if(descs.set){
							descs.set.call(this, false);
						}
					}
				},
				reflect: true,
				propType: 'boolean',
				initAttr: descs.initAttr || false
			});
		},
		contentAttr: function(elem, name, val){
			if(!elem.nodeName){return;}
			var attr;
			if(val === undefined){
				attr = (elem.attributes[name] || {});
				val = attr.specified ? attr.value : null;
				return (val == null) ? undefined : val;
			}
			
			if(typeof val == 'boolean'){
				if(!val){
					elem.removeAttribute(name);
				} else {
					elem.setAttribute(name, name);
				}
			} else {
				elem.setAttribute(name, val);
			}
		},
		
//		set current Lang:
//			- webshims.activeLang(lang:string);
//		get current lang
//			- webshims.activeLang();
//		get current lang
//			webshims.activeLang({
//				register: moduleName:string,
//				callback: callback:function
//			});
//		get/set including removeLang
//			- webshims.activeLang({
//				module: moduleName:string,
//				callback: callback:function,
//				langObj: languageObj:array/object
//			});
		activeLang: (function(){
			var callbacks = [];
			var registeredCallbacks = {};
			var currentLang;
			var shortLang;
			var notLocal = /:\/\/|^\.*\//;
			var loadRemoteLang = function(data, lang, options){
				var langSrc;
				if(lang && options && $.inArray(lang, options.availabeLangs || []) !== -1){
					data.loading = true;
					langSrc = options.langSrc;
					if(!notLocal.test(langSrc)){
						langSrc = webshims.cfg.basePath+langSrc;
					}
					webshims.loader.loadScript(langSrc+lang+'.js', function(){
						if(data.langObj[lang]){
							data.loading = false;
							callLang(data, true);
						} else {
							$(function(){
								if(data.langObj[lang]){
									callLang(data, true);
								}
								data.loading = false;
							});
						}
					});
					return true;
				}
				return false;
			};
			var callRegister = function(module){
				if(registeredCallbacks[module]){
					registeredCallbacks[module].forEach(function(data){
						data.callback(currentLang, shortLang, '');
					});
				}
			};
			var callLang = function(data, _noLoop){
				if(data.activeLang != currentLang && data.activeLang !== shortLang){
					var options = modules[data.module].options;
					if( data.langObj[currentLang] || (shortLang && data.langObj[shortLang]) ){
						data.activeLang = currentLang;
						data.callback(data.langObj[currentLang] || data.langObj[shortLang], currentLang);
						callRegister(data.module);
					} else if( !_noLoop &&
						!loadRemoteLang(data, currentLang, options) && 
						!loadRemoteLang(data, shortLang, options) && 
						data.langObj[''] && data.activeLang !== '' ) {
						data.activeLang = '';
						data.callback(data.langObj[''], currentLang);
						callRegister(data.module);
					}
				}
			};
			
			
			var activeLang = function(lang){
				
				if(typeof lang == 'string' && lang !== currentLang){
					currentLang = lang;
					shortLang = currentLang.split('-')[0];
					if(currentLang == shortLang){
						shortLang = false;
					}
					$.each(callbacks, function(i, data){
						callLang(data);
					});
				} else if(typeof lang == 'object'){
					
					if(lang.register){
						if(!registeredCallbacks[lang.register]){
							registeredCallbacks[lang.register] = [];
						}
						registeredCallbacks[lang.register].push(lang);
						lang.callback(currentLang, shortLang, '');
					} else {
						if(!lang.activeLang){
							lang.activeLang = '';
						}
						callbacks.push(lang);
						callLang(lang);
					}
				}
				return currentLang;
			};
			
			return activeLang;
		})()
	});
	
	$.each({
		defineNodeNamesProperty: 'defineNodeNameProperty',
		defineNodeNamesProperties: 'defineNodeNameProperties',
		createElements: 'createElement'
	}, function(name, baseMethod){
		webshims[name] = function(names, a, b, c){
			if(typeof names == 'string'){
				names = names.split(listReg);
			}
			var retDesc = {};
			names.forEach(function(nodeName){
				retDesc[nodeName] = webshims[baseMethod](nodeName, a, b, c);
			});
			return retDesc;
		};
	});
	
	webshims.isReady('webshimLocalization', true);
});
//html5a11y
(function($, document){
	if(!$.webshims.assumeARIA || ('content' in document.createElement('template'))){return;}
	
	$(function(){
		var main = $('main').attr({role: 'main'});
		if(main.length > 1){
			webshims.error('only one main element allowed in document');
		} else if(main.is('article *, section *')) {
			webshims.error('main not allowed inside of article/section elements');
		}
	});
	
	if(('hidden' in document.createElement('a'))){
		return;
	}
	
	var elemMappings = {
		article: "article",
		aside: "complementary",
		section: "region",
		nav: "navigation",
		address: "contentinfo"
	};
	var addRole = function(elem, role){
		var hasRole = elem.getAttribute('role');
		if (!hasRole) {
			elem.setAttribute('role', role);
		}
	};
	
	
	$.webshims.addReady(function(context, contextElem){
		$.each(elemMappings, function(name, role){
			var elems = $(name, context).add(contextElem.filter(name));
			for (var i = 0, len = elems.length; i < len; i++) {
				addRole(elems[i], role);
			}
		});
		if (context === document) {
			var header = document.getElementsByTagName('header')[0];
			var footers = document.getElementsByTagName('footer');
			var footerLen = footers.length;
			
			if (header && !$(header).closest('section, article')[0]) {
				addRole(header, 'banner');
			}
			if (!footerLen) {
				return;
			}
			var footer = footers[footerLen - 1];
			if (!$(footer).closest('section, article')[0]) {
				addRole(footer, 'contentinfo');
			}
		}
	});
	
})(jQuery, document);

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
if(!Modernizr.formvalidation || jQuery.webshims.bugs.bustedValidity){
jQuery.webshims.register('form-shim-extend', function($, webshims, window, document, undefined, options){
"use strict";
webshims.inputTypes = webshims.inputTypes || {};
//some helper-functions
var cfg = webshims.cfg.forms;
var isSubmit;

var isNumber = function(string){
		return (typeof string == 'number' || (string && string == string * 1));
	},
	typeModels = webshims.inputTypes,
	checkTypes = {
		radio: 1,
		checkbox: 1
	},
	getType = function(elem){
		return (elem.getAttribute('type') || elem.type || '').toLowerCase();
	}
;

//API to add new input types
webshims.addInputType = function(type, obj){
	typeModels[type] = obj;
};

//contsrain-validation-api
var validityPrototype = {
	customError: false,

	typeMismatch: false,
	rangeUnderflow: false,
	rangeOverflow: false,
	stepMismatch: false,
	tooLong: false,
	patternMismatch: false,
	valueMissing: false,
	
	valid: true
};

var isPlaceholderOptionSelected = function(select){
	if(select.type == 'select-one' && select.size < 2){
		var option = $('> option:first-child', select);
		return !!option.prop('selected');
	} 
	return false;
};

var validityRules = {
		valueMissing: function(input, val, cache){
			if(!input.prop('required')){return false;}
			var ret = false;
			if(!('type' in cache)){
				cache.type = getType(input[0]);
			}
			if(cache.nodeName == 'select'){
				ret = (!val && (input[0].selectedIndex < 0 || isPlaceholderOptionSelected(input[0]) ));
			} else if(checkTypes[cache.type]){
				ret = (cache.type == 'checkbox') ? !input.is(':checked') : !webshims.modules["form-core"].getGroupElements(input).filter(':checked')[0];
			} else {
				ret = !(val);
			}
			return ret;
		},
		tooLong: function(){
			return false;
		},
		typeMismatch: function (input, val, cache){
			if(val === '' || cache.nodeName == 'select'){return false;}
			var ret = false;
			if(!('type' in cache)){
				cache.type = getType(input[0]);
			}
			
			if(typeModels[cache.type] && typeModels[cache.type].mismatch){
				ret = typeModels[cache.type].mismatch(val, input);
			} else if('validity' in input[0]){
				ret = input[0].validity.typeMismatch;
			}
			return ret;
		},
		patternMismatch: function(input, val, cache) {
			if(val === '' || cache.nodeName == 'select'){return false;}
			var pattern = input.attr('pattern');
			if(!pattern){return false;}
			try {
				pattern = new RegExp('^(?:' + pattern + ')$');
			} catch(er){
				webshims.error('invalid pattern value: "'+ pattern +'" | '+ er);
				pattern = false;
			}
			if(!pattern){return false;}
			return !(pattern.test(val));
		}
	}
;

webshims.addValidityRule = function(type, fn){
	validityRules[type] = fn;
};

$.event.special.invalid = {
	add: function(){
		$.event.special.invalid.setup.call(this.form || this);
	},
	setup: function(){
		var form = this.form || this;
		if( $.data(form, 'invalidEventShim') ){
			form = null;
			return;
		}
		$(form)
			.data('invalidEventShim', true)
			.on('submit', $.event.special.invalid.handler)
		;
		webshims.moveToFirstEvent(form, 'submit');
		if(webshims.bugs.bustedValidity && $.nodeName(form, 'form')){
			(function(){
				var noValidate = form.getAttribute('novalidate');
				form.setAttribute('novalidate', 'novalidate');
				webshims.data(form, 'bustedNoValidate', (noValidate == null) ? null : noValidate);
			})();
		}
		form = null;
	},
	teardown: $.noop,
	handler: function(e, d){
		
		if( e.type != 'submit' || e.testedValidity || !e.originalEvent || !$.nodeName(e.target, 'form') || $.prop(e.target, 'noValidate') ){return;}
		
		isSubmit = true;
		e.testedValidity = true;
		var notValid = !($(e.target).checkValidity());
		if(notValid){
			e.stopImmediatePropagation();
			isSubmit = false;
			return false;
		}
		isSubmit = false;
	}
};

var addSubmitBubbles = function(form){
	if (!$.support.submitBubbles && form && typeof form == 'object' && !form._submit_attached ) {
				
		$.event.add( form, 'submit._submit', function( event ) {
			event._submit_bubble = true;
		});
		
		form._submit_attached = true;
	}
};
if(!$.support.submitBubbles && $.event.special.submit){
	$.event.special.submit.setup = function() {
		// Only need this for delegated form submit events
		if ( $.nodeName( this, "form" ) ) {
			return false;
		}

		// Lazy-add a submit handler when a descendant form may potentially be submitted
		$.event.add( this, "click._submit keypress._submit", function( e ) {
			// Node name check avoids a VML-related crash in IE (#9807)
			var elem = e.target,
				form = $.nodeName( elem, 'input' ) || $.nodeName( elem, 'button' ) ? $.prop(elem, 'form') : undefined;
			addSubmitBubbles(form);
			
		});
		// return undefined since we don't need an event listener
	};
}

$.event.special.submit = $.event.special.submit || {setup: function(){return false;}};
var submitSetup = $.event.special.submit.setup;
$.extend($.event.special.submit, {
	setup: function(){
		if($.nodeName(this, 'form')){
			$(this).on('invalid', $.noop);
		} else {
			$('form', this).on('invalid', $.noop);
		}
		return submitSetup.apply(this, arguments);
	}
});

$(window).on('invalid', $.noop);


webshims.addInputType('email', {
	mismatch: (function(){
		//taken from http://www.whatwg.org/specs/web-apps/current-work/multipage/states-of-the-type-attribute.html#valid-e-mail-address
		var test = cfg.emailReg || /^[a-zA-Z0-9.!#$%&'*+-\/=?\^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
		return function(val){
			return !test.test(val);
		};
	})()
});

webshims.addInputType('url', {
	mismatch: (function(){
		//taken from scott gonzales
		var test = cfg.urlReg || /^([a-z]([a-z]|\d|\+|-|\.)*):(\/\/(((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:)*@)?((\[(|(v[\da-f]{1,}\.(([a-z]|\d|-|\.|_|~)|[!\$&'\(\)\*\+,;=]|:)+))\])|((\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5]))|(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=])*)(:\d*)?)(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*|(\/((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)?)|((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)|((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)){0})(\?((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|[\uE000-\uF8FF]|\/|\?)*)?(\#((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|\/|\?)*)?$/i;
		return function(val){
			return !test.test(val);
		};
	})()
});

webshims.defineNodeNameProperty('input', 'type', {
	prop: {
		get: function(){
			var elem = this;
			var type = (elem.getAttribute('type') || '').toLowerCase();
			return (webshims.inputTypes[type]) ? type : elem.type;
		}
	}
});

// IDLs for constrain validation API
//ToDo: add object to this list
webshims.defineNodeNamesProperties(['button', 'fieldset', 'output'], {
	checkValidity: {
		value: function(){return true;}
	},
	willValidate: {
		value: false
	},
	setCustomValidity: {
		value: $.noop
	},
	validity: {
		writeable: false,
		get: function(){
			return $.extend({}, validityPrototype);
		}
	}
}, 'prop');

var baseCheckValidity = function(elem){
	var e,
		v = $.prop(elem, 'validity')
	;
	if(v){
		$.data(elem, 'cachedValidity', v);
	} else {
		return true;
	}
	if( !v.valid ){
		e = $.Event('invalid');
		var jElm = $(elem).trigger(e);
		if(isSubmit && !baseCheckValidity.unhandledInvalids && !e.isDefaultPrevented()){
			webshims.validityAlert.showFor(jElm);
			baseCheckValidity.unhandledInvalids = true;
		}
	}
	$.removeData(elem, 'cachedValidity');
	return v.valid;
};
var rsubmittable = /^(?:select|textarea|input)/i;
webshims.defineNodeNameProperty('form', 'checkValidity', {
	prop: {
		value: function(){
			
			var ret = true,
				elems = $($.prop(this, 'elements')).filter(function(){
					if(!rsubmittable.test(this.nodeName)){return false;}
					var shadowData = webshims.data(this, 'shadowData');
					return !shadowData || !shadowData.nativeElement || shadowData.nativeElement === this;
				})
			;
			
			baseCheckValidity.unhandledInvalids = false;
			for(var i = 0, len = elems.length; i < len; i++){
				if( !baseCheckValidity(elems[i]) ){
					ret = false;
				}
			}
			return ret;
		}
	}
});

webshims.defineNodeNamesProperties(['input', 'textarea', 'select'], {
	checkValidity: {
		value: function(){
			baseCheckValidity.unhandledInvalids = false;
			return baseCheckValidity($(this).getNativeElement()[0]);
		}
	},
	setCustomValidity: {
		value: function(error){
			$.removeData(this, 'cachedValidity');
			webshims.data(this, 'customvalidationMessage', ''+error);
		}
	},
	willValidate: {
		writeable: false,
		get: (function(){
			var types = {
					button: 1,
					reset: 1,
					hidden: 1,
					image: 1
				}
			;
			return function(){
				var elem = $(this).getNativeElement()[0];
				//elem.name && <- we don't use to make it easier for developers
				return !!(!elem.disabled && !elem.readOnly && !types[elem.type] );
			};
		})()
	},
	validity: {
		writeable: false,
		get: function(){
			var jElm = $(this).getNativeElement();
			var elem = jElm[0];
			var validityState = $.data(elem, 'cachedValidity');
			if(validityState){
				return validityState;
			}
			validityState 	= $.extend({}, validityPrototype);
			
			if( !$.prop(elem, 'willValidate') || elem.type == 'submit' ){
				return validityState;
			}
			var val 	= jElm.val(),
				cache 	= {nodeName: elem.nodeName.toLowerCase()}
			;
			
			validityState.customError = !!(webshims.data(elem, 'customvalidationMessage'));
			if( validityState.customError ){
				validityState.valid = false;
			}
							
			$.each(validityRules, function(rule, fn){
				if (fn(jElm, val, cache)) {
					validityState[rule] = true;
					validityState.valid = false;
				}
			});
			$(this).getShadowFocusElement().attr('aria-invalid',  validityState.valid ? 'false' : 'true');
			jElm = null;
			elem = null;
			return validityState;
		}
	}
}, 'prop');

webshims.defineNodeNamesBooleanProperty(['input', 'textarea', 'select'], 'required', {
	set: function(value){
		$(this).getShadowFocusElement().attr('aria-required', !!(value)+'');
	},
	initAttr: Modernizr.localstorage //only if we have aria-support
});

webshims.reflectProperties(['input'], ['pattern']);


if( !('maxLength' in document.createElement('textarea')) ){
	var constrainMaxLength = (function(){
		var timer;
		var curLength = 0;
		var lastElement = $([]);
		var max = 1e9;
		var constrainLength = function(){
			var nowValue = lastElement.prop('value');
			var nowLen = nowValue.length;
			if(nowLen > curLength && nowLen > max){
				nowLen = Math.max(curLength, max);
				lastElement.prop('value', nowValue.substr(0, nowLen ));
			}
			curLength = nowLen;
		};
		var remove = function(){
			clearTimeout(timer);
			lastElement.unbind('.maxlengthconstraint');
		};
		return function(element, maxLength){
			remove();
			if(maxLength > -1){
				max = maxLength;
				curLength = $.prop(element, 'value').length;
				lastElement = $(element);
				lastElement.on({
					'keydown.maxlengthconstraint keypress.maxlengthconstraint paste.maxlengthconstraint cut.maxlengthconstraint': function(e){
						setTimeout(constrainLength, 0);
					},
					'keyup.maxlengthconstraint': constrainLength,
					'blur.maxlengthconstraint': remove
				});
				timer = setInterval(constrainLength, 200);
			}
		};
	})();
	
	constrainMaxLength.update = function(element, maxLength){
		if($(element).is(':focus')){
			if(!maxLength){
				maxLength = $.prop(element, 'maxlength');
			}
			constrainMaxLength(element, maxLength);
		}
	};
	
	$(document).on('focusin', function(e){
		var maxLength;
		if(e.target.nodeName == "TEXTAREA" && (maxLength = $.prop(e.target, 'maxlength')) > -1){
			constrainMaxLength(e.target, maxLength);
		}
	});
	
	webshims.defineNodeNameProperty('textarea', 'maxlength', {
		attr: {
			set: function(val){
				this.setAttribute('maxlength', ''+val);
				constrainMaxLength.update(this);
			},
			get: function(){
				var ret = this.getAttribute('maxlength');
				return ret == null ? undefined : ret;
			}
		},
		prop: {
			set: function(val){
				if(isNumber(val)){
					if(val < 0){
						throw('INDEX_SIZE_ERR');
					}
					val = parseInt(val, 10);
					this.setAttribute('maxlength', val);
					constrainMaxLength.update(this, val);
					return;
				}
				this.setAttribute('maxlength', '0');
				constrainMaxLength.update(this, 0);
			},
			get: function(){
				var val = this.getAttribute('maxlength');
				return (isNumber(val) && val >= 0) ? parseInt(val, 10) : -1; 
				
			}
		}
	});
	webshims.defineNodeNameProperty('textarea', 'maxLength', {
		prop: {
			set: function(val){
				$.prop(this, 'maxlength', val);
			},
			get: function(){
				return $.prop(this, 'maxlength');
			}
		}
	});
} 



var submitterTypes = {submit: 1, button: 1, image: 1};
var formSubmitterDescriptors = {};
[
	{
		name: "enctype",
		limitedTo: {
			"application/x-www-form-urlencoded": 1,
			"multipart/form-data": 1,
			"text/plain": 1
		},
		defaultProp: "application/x-www-form-urlencoded",
		proptype: "enum"
	},
	{
		name: "method",
		limitedTo: {
			"get": 1,
			"post": 1
		},
		defaultProp: "get",
		proptype: "enum"
	},
	{
		name: "action",
		proptype: "url"
	},
	{
		name: "target"
	},
	{
		name: "novalidate",
		propName: "noValidate",
		proptype: "boolean"
	}
].forEach(function(desc){
	var propName = 'form'+ (desc.propName || desc.name).replace(/^[a-z]/, function(f){
		return f.toUpperCase();
	});
	var attrName = 'form'+ desc.name;
	var formName = desc.name;
	var eventName = 'click.webshimssubmittermutate'+formName;
	
	var changeSubmitter = function(){
		var elem = this;
		if( !('form' in elem) || !submitterTypes[elem.type] ){return;}
		var form = $.prop(elem, 'form');
		if(!form){return;}
		var attr = $.attr(elem, attrName);
		if(attr != null && ( !desc.limitedTo || attr.toLowerCase() === $.prop(elem, propName))){
			
			var oldAttr = $.attr(form, formName);
			
			$.attr(form, formName, attr);
			setTimeout(function(){
				if(oldAttr != null){
					$.attr(form, formName, oldAttr);
				} else {
					try {
						$(form).removeAttr(formName);
					} catch(er){
						form.removeAttribute(formName);
					}
				}
			}, 9);
		}
	};
	
	

switch(desc.proptype) {
		case "url":
			var urlForm = document.createElement('form');
			formSubmitterDescriptors[propName] = {
				prop: {
					set: function(value){
						$.attr(this, attrName, value);
					},
					get: function(){
						var value = $.attr(this, attrName);
						if(value == null){return '';}
						urlForm.setAttribute('action', value);
						return urlForm.action;
					}
				}
			};
			break;
		case "boolean":
			formSubmitterDescriptors[propName] = {
				prop: {
					set: function(val){
						val = !!val;
						if(val){
							$.attr(this, 'formnovalidate', 'formnovalidate');
						} else {
							$(this).removeAttr('formnovalidate');
						}
					},
					get: function(){
						return $.attr(this, 'formnovalidate') != null;
					}
				}
			};
			break;
		case "enum":
			formSubmitterDescriptors[propName] = {
				prop: {
					set: function(value){
						$.attr(this, attrName, value);
					},
					get: function(){
						var value = $.attr(this, attrName);
						return (!value || ( (value = value.toLowerCase()) && !desc.limitedTo[value] )) ? desc.defaultProp : value;
					}
				}
		};
		break;
		default:
			formSubmitterDescriptors[propName] = {
				prop: {
					set: function(value){
						$.attr(this, attrName, value);
					},
					get: function(){
						var value = $.attr(this, attrName);
						return (value != null) ? value : "";
					}
				}
			};
	}


	if(!formSubmitterDescriptors[attrName]){
		formSubmitterDescriptors[attrName] = {};
	}
	formSubmitterDescriptors[attrName].attr = {
		set: function(value){
			formSubmitterDescriptors[attrName].attr._supset.call(this, value);
			$(this).unbind(eventName).on(eventName, changeSubmitter);
		},
		get: function(){
			return formSubmitterDescriptors[attrName].attr._supget.call(this);
		}
	};
	formSubmitterDescriptors[attrName].initAttr = true;
	formSubmitterDescriptors[attrName].removeAttr = {
		value: function(){
			$(this).unbind(eventName);
			formSubmitterDescriptors[attrName].removeAttr._supvalue.call(this);
		}
	};
});

webshims.defineNodeNamesProperties(['input', 'button'], formSubmitterDescriptors);


if(!$.support.getSetAttribute && $('<form novalidate></form>').attr('novalidate') == null){
	webshims.defineNodeNameProperty('form', 'novalidate', {
		attr: {
			set: function(val){
				this.setAttribute('novalidate', ''+val);
			},
			get: function(){
				var ret = this.getAttribute('novalidate');
				return ret == null ? undefined : ret;
			}
		}
	});
} else if(webshims.bugs.bustedValidity){
	
	webshims.defineNodeNameProperty('form', 'novalidate', {
		attr: {
			set: function(val){
				webshims.data(this, 'bustedNoValidate', ''+val);
			},
			get: function(){
				var ret = webshims.data(this, 'bustedNoValidate');
				return ret == null ? undefined : ret;
			}
		},
		removeAttr: {
			value: function(){
				webshims.data(this, 'bustedNoValidate', null);
			}
		}
	});
	
	$.each(['rangeUnderflow', 'rangeOverflow', 'stepMismatch'], function(i, name){
		validityRules[name] = function(elem){
			return (elem[0].validity || {})[name] || false;
		};
	});
	
}

webshims.defineNodeNameProperty('form', 'noValidate', {
	prop: {
		set: function(val){
			val = !!val;
			if(val){
				$.attr(this, 'novalidate', 'novalidate');
			} else {
				$(this).removeAttr('novalidate');
			}
		},
		get: function(){
			return $.attr(this, 'novalidate') != null;
		}
	}
});

if(Modernizr.inputtypes.date && /webkit/i.test(navigator.userAgent)){
	(function(){
		
		var noInputTriggerEvts = {updateInput: 1, input: 1},
			fixInputTypes = {
				date: 1,
				time: 1,
				"datetime-local": 1
			},
			noFocusEvents = {
				focusout: 1,
				blur: 1
			},
			changeEvts = {
				updateInput: 1,
				change: 1
			},
			observe = function(input){
				var timer,
					focusedin = true,
					lastInputVal = input.prop('value'),
					lastChangeVal = lastInputVal,
					trigger = function(e){
						//input === null
						if(!input){return;}
						var newVal = input.prop('value');
						
						if(newVal !== lastInputVal){
							lastInputVal = newVal;
							if(!e || !noInputTriggerEvts[e.type]){
								input.trigger('input');
							}
						}
						if(e && changeEvts[e.type]){
							lastChangeVal = newVal;
						}
						if(!focusedin && newVal !== lastChangeVal){
							input.trigger('change');
						}
					},
					extraTimer,
					extraTest = function(){
						clearTimeout(extraTimer);
						extraTimer = setTimeout(trigger, 9);
					},
					unbind = function(e){
						clearInterval(timer);
						setTimeout(function(){
							if(e && noFocusEvents[e.type]){
								focusedin = false;
							}
							if(input){
								input.unbind('focusout blur', unbind).unbind('input change updateInput', trigger);
								trigger();
							}
							input = null;
						}, 1);
						
					}
				;
				
				clearInterval(timer);
				timer = setInterval(trigger, 160);
				extraTest();
				input
					.off({
						'focusout blur': unbind,
						'input change updateInput': trigger
					})
					.on({
						'focusout blur': unbind,
						'input updateInput change': trigger
					})
				;
			}
		;
		if($.event.customEvent){
			$.event.customEvent.updateInput = true;
		}
		
		(function(){
			
			var correctValue = function(elem){
				var i = 1;
				var len = 3;
				var abort, val;
				if(elem.type == 'date' && (isSubmit || !$(elem).is(':focus'))){
					val = elem.value;
					if(val && val.length < 10 && (val = val.split('-')) && val.length == len){
						for(; i < len; i++){
							if(val[i].length == 1){
								val[i] = '0'+val[i];
							} else if(val[i].length != 2){
								abort = true;
								break;
							}
						}
						if(!abort){
							val = val.join('-');
							$.prop(elem, 'value', val);
							return val;
						}
					}
				}
			};
			var inputCheckValidityDesc, formCheckValidityDesc, inputValueDesc, inputValidityDesc;
			
			inputCheckValidityDesc = webshims.defineNodeNameProperty('input', 'checkValidity', {
				prop: {
					value: function(){
						correctValue(this);
						return inputCheckValidityDesc.prop._supvalue.apply(this, arguments);
					}
				}
			});
			
			formCheckValidityDesc = webshims.defineNodeNameProperty('form', 'checkValidity', {
				prop: {
					value: function(){
						$('input', this).each(function(){
							correctValue(this);
						});
						return formCheckValidityDesc.prop._supvalue.apply(this, arguments);
					}
				}
			});
			
			inputValueDesc = webshims.defineNodeNameProperty('input', 'value', {
				prop: {
					set: function(){
						return inputValueDesc.prop._supset.apply(this, arguments);
					},
					get: function(){
						return correctValue(this) || inputValueDesc.prop._supget.apply(this, arguments);
					}
				}
			});
			
			inputValidityDesc = webshims.defineNodeNameProperty('input', 'validity', {
				prop: {
					writeable: false,
					get: function(){
						correctValue(this);
						return inputValidityDesc.prop._supget.apply(this, arguments);
					}
				}
			});
			
			$(document).on('change', function(e){
				correctValue(e.target);
			});
			
		})();
		
		$(document)
			.on('focusin', function(e){
				if( e.target && fixInputTypes[e.target.type] && !e.target.readOnly && !e.target.disabled ){
					observe($(e.target));
				}
			})
		;
		
		
	})();
}

webshims.addReady(function(context, contextElem){
	//start constrain-validation
	var focusElem;
	$('form', context)
		.add(contextElem.filter('form'))
		.bind('invalid', $.noop)
	;
	
	try {
		if(context == document && !('form' in (document.activeElement || {}))) {
			focusElem = $('input[autofocus], select[autofocus], textarea[autofocus]', context).eq(0).getShadowFocusElement()[0];
			if (focusElem && focusElem.offsetHeight && focusElem.offsetWidth) {
				focusElem.focus();
			}
		}
	} 
	catch (er) {}
	
});

if(!Modernizr.formattribute || !Modernizr.fieldsetdisabled){
	(function(){
		(function(prop, undefined){
			$.prop = function(elem, name, value){
				var ret;
				if(elem && elem.nodeType == 1 && value === undefined && $.nodeName(elem, 'form') && elem.id){
					ret = document.getElementsByName(name);
					if(!ret || !ret.length){
						ret = document.getElementById(name);
					}
					if(ret){
						ret = $(ret).filter(function(){
							return $.prop(this, 'form') == elem;
						}).get();
						if(ret.length){
							return ret.length == 1 ? ret[0] : ret;
						}
					}
				}
				return prop.apply(this, arguments);
			};
		})($.prop, undefined);
		var removeAddedElements = function(form){
			var elements = $.data(form, 'webshimsAddedElements');
			if(elements){
				elements.remove();
				$.removeData(form, 'webshimsAddedElements');
			}
		};
		
		
		if(!Modernizr.formattribute){
			webshims.defineNodeNamesProperty(['input', 'textarea', 'select', 'button', 'fieldset'], 'form', {
				prop: {
					get: function(){
						var form = webshims.contentAttr(this, 'form');
						if(form){
							form = document.getElementById(form);
							if(form && !$.nodeName(form, 'form')){
								form = null;
							}
						} 
						return form || this.form;
					},
					writeable: false
				}
			});
			
			
			webshims.defineNodeNamesProperty(['form'], 'elements', {
				prop: {
					get: function(){
						var id = this.id;
						var elements = $.makeArray(this.elements);
						if(id){
							elements = $(elements).add('input[form="'+ id +'"], select[form="'+ id +'"], textarea[form="'+ id +'"], button[form="'+ id +'"], fieldset[form="'+ id +'"]').not('.webshims-visual-hide > *').get();
						}
						return elements;
					},
					writeable: false
				}
			});
			
			
			
			$(function(){
				var stopPropagation = function(e){
					e.stopPropagation();
				};
				$(document).on('submit', function(e){
					
					if(!e.isDefaultPrevented()){
						var form = e.target;
						var id = form.id;
						var elements;
						
						
						if(id){
							removeAddedElements(form);
							
							elements = $('input[form="'+ id +'"], select[form="'+ id +'"], textarea[form="'+ id +'"]')
								.filter(function(){
									return !this.disabled && this.name && this.form != form;
								})
								.clone()
							;
							if(elements.length){
								$.data(form, 'webshimsAddedElements', $('<div class="webshims-visual-hide" />').append(elements).appendTo(form));
								setTimeout(function(){
									removeAddedElements(form);
								}, 9);
							}
							elements = null;
						}
					}
				});
				
				$(document).on('click', function(e){
					if(!e.isDefaultPrevented() && $(e.target).is('input[type="submit"][form], button[form], input[type="button"][form], input[type="image"][form], input[type="reset"][form]')){
						var trueForm = $.prop(e.target, 'form');
						var formIn = e.target.form;
						var clone;
						if(trueForm && trueForm != formIn){
							clone = $(e.target)
								.clone()
								.removeAttr('form')
								.addClass('webshims-visual-hide')
								.on('click', stopPropagation)
								.appendTo(trueForm)
							;
							if(formIn){
								e.preventDefault();
							}
							addSubmitBubbles(trueForm);
							clone.trigger('click');
							setTimeout(function(){
								clone.remove();
								clone = null;
							}, 9);
						}
					}
				});
			});
		}
		
		if(!Modernizr.fieldsetdisabled){
			webshims.defineNodeNamesProperty(['fieldset'], 'elements', {
				prop: {
					get: function(){
						//add listed elements without keygen, object, output
						return $('input, select, textarea, button, fieldset', this).get() || [];
					},
					writeable: false
				}
			});
		}
		
		if(!$.fn.finish && parseFloat($.fn.jquery, 10) < 1.9){
			var rCRLF = /\r?\n/g,
				rinput = /^(?:color|date|datetime|datetime-local|email|hidden|month|number|password|range|search|tel|text|time|url|week)$/i,
				rselectTextarea = /^(?:select|textarea)/i;
			$.fn.serializeArray = function() {
					return this.map(function(){
						var elements = $.prop(this, 'elements');
						return elements ? $.makeArray( elements ) : this;
					})
					.filter(function(){
						return this.name && !this.disabled &&
							( this.checked || rselectTextarea.test( this.nodeName ) ||
								rinput.test( this.type ) );
					})
					.map(function( i, elem ){
						var val = $( this ).val();
			
						return val == null ?
							null :
							$.isArray( val ) ?
								$.map( val, function( val, i ){
									return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
								}) :
								{ name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
					}).get();
				};
		}
		
	})();
}

	if($('<input />').prop('labels') == null){
		webshims.defineNodeNamesProperty('button, input, keygen, meter, output, progress, select, textarea', 'labels', {
			prop: {
				get: function(){
					if(this.type == 'hidden'){return null;}
					var id = this.id;
					var labels = $(this)
						.closest('label')
						.filter(function(){
							var hFor = (this.attributes['for'] || {});
							return (!hFor.specified || hFor.value == id);
						})
					;
					
					if(id) {
						labels = labels.add('label[for="'+ id +'"]');
					}
					return labels.get();
				},
				writeable: false
			}
		});
	}
	
	if(!('value' in document.createElement('progress'))){
		(function(){
			
			var nan = parseInt('NaN', 10);
			
			var updateProgress = function(progress){
				var position;
				
				
				position = $.prop(progress, 'position');
				
				$.attr(progress, 'data-position', position);
				$('> span', progress).css({width: (position < 0 ?  100 : position * 100) +'%'});
			};
			var desc = {
				position: {
					prop: {
						get: function(){
							var max;
							//jQuery 1.8.x try's to normalize "0" to 0
							var val = this.getAttribute('value');
							var ret = -1;
							
							val = val ? (val * 1) : nan; 
							if(!isNaN(val)){
								max = $.prop(this, 'max');
								ret = Math.max(Math.min(val / max, 1), 0);
								if(updateProgress.isInChange){
									$.attr(this, 'aria-valuenow', ret * 100);
									if(updateProgress.isInChange == 'max'){
										$.attr(this, 'aria-valuemax', max);
									}
								}
							} else if(updateProgress.isInChange) {
								$(this).removeAttr('aria-valuenow');
							}
							return ret;
						},
						writeable: false
					}
				}
			};
			
			$.each({value: 0, max: 1}, function(name, defValue){
				var removeProp = (name == 'value' && !$.fn.finish);
				desc[name] = {
					attr: {
						set: function(value){
							var ret = desc[name].attr._supset.call(this, value);
							updateProgress.isInChange = name;
							updateProgress(this);
							updateProgress.isInChange = false;
							return ret;
						}
					},
					removeAttr: {
						value: function(){
							this.removeAttribute(name);
							if(removeProp){
								delete this.value;
							}
							updateProgress.isInChange = name;
							updateProgress(this);
							updateProgress.isInChange = false;
						}
					},
					prop: {
						get: function(){
							var max;
							var ret = (desc[name].attr.get.call(this) * 1);
							if(ret < 0 || isNaN(ret)){
								ret = defValue;
							} else if(name == 'value'){
								ret = Math.min(ret, $.prop(this, 'max'));
							} else if(ret === 0){
								ret = defValue;
							}
							return ret;
						},
						set: function(value){
							value = value * 1;
							if(isNaN(value)){
								webshims.error('Floating-point value is not finite.');
							}
							return desc[name].attr.set.call(this, value);
						}
					}
				};
			});
			
			webshims.createElement(
				'progress', 
				function(){
					var labels = $(this)
						.attr({role: 'progressbar', 'aria-valuemin': '0'})
						.html('<span class="progress-value" />')
						.jProp('labels')
						.map(function(){
							return webshims.getID(this);
						})
						.get()
					;
					if(labels.length){
						$.attr(this, 'aria-labelledby', labels.join(' '));
					} else {
						webshims.info("you should use label elements for your prgogress elements");
					}
					
					updateProgress.isInChange = 'max';
					updateProgress(this);
					updateProgress.isInChange = false;
				}, 
				desc
			);
				
		})();
	}

try {
	document.querySelector(':checked');
} catch(er){
	(function(){
		$('html').addClass('no-csschecked');
		var checkInputs = {
			radio: 1,
			checkbox: 1
		};
		var selectChange = function(){
			var options = this.options || [];
			var i, len, option;
			for(i = 0, len = options.length; i < len; i++){
				option = $(options[i]);
				option[$.prop(options[i], 'selected') ? 'addClass' : 'removeClass']('prop-checked');
			}
		};
		var checkChange = function(){
			var fn = $.prop(this, 'checked')  ? 'addClass' : 'removeClass';
			var className = this.className || '';
			var parent;
			
			//IE8- has problems to update styles, we help
			if( (className.indexOf('prop-checked') == -1) == (fn == 'addClass')){ 
				$(this)[fn]('prop-checked');
				if((parent = this.parentNode)){
					parent.className = parent.className;
				}
			}
		};
		
		
		webshims.onNodeNamesPropertyModify('select', 'value', selectChange);
		webshims.onNodeNamesPropertyModify('select', 'selectedIndex', selectChange);
		webshims.onNodeNamesPropertyModify('option', 'selected', function(){
			$(this).closest('select').each(selectChange);
		});
		webshims.onNodeNamesPropertyModify('input', 'checked', function(value, boolVal){
			var type = this.type;
			if(type == 'radio' && boolVal){
				webshims.modules["form-core"].getGroupElements(this).each(checkChange);
			} else if(checkInputs[type]) {
				$(this).each(checkChange);
			}
		});
		
		$(document).on('change', function(e){
			
			if(checkInputs[e.target.type]){
				if(e.target.type == 'radio'){
					webshims.modules["form-core"].getGroupElements(e.target).each(checkChange);
				} else {
					$(e.target)[$.prop(e.target, 'checked') ? 'addClass' : 'removeClass']('prop-checked');
				}
			} else if(e.target.nodeName.toLowerCase() == 'select'){
				$(e.target).each(selectChange);
			}
		});
		
		webshims.addReady(function(context, contextElem){
			$('option, input', context)
				.add(contextElem.filter('option, input'))
				.each(function(){
					var prop;
					if(checkInputs[this.type]){
						prop = 'checked';
					} else if(this.nodeName.toLowerCase() == 'option'){
						prop = 'selected';
					}  
					if(prop){
						$(this)[$.prop(this, prop) ? 'addClass' : 'removeClass']('prop-checked');
					}
					
				})
			;
		});
	})();
}

(function(){
	var bustedPlaceholder;
	Modernizr.textareaPlaceholder = !!('placeholder' in $('<textarea />')[0]);
	if(Modernizr.input.placeholder && options.overridePlaceholder){
		bustedPlaceholder = true;
	}
	if(Modernizr.input.placeholder && Modernizr.textareaPlaceholder && !bustedPlaceholder){
		(function(){
			var ua = navigator.userAgent;
			
			if(ua.indexOf('Mobile') != -1 && ua.indexOf('Safari') != -1){
				$(window).on('orientationchange', (function(){
					var timer;
					var retVal = function(i, value){
						return value;
					};
					
					var set = function(){
						$('input[placeholder], textarea[placeholder]').attr('placeholder', retVal);
					};
					return function(e){
						clearTimeout(timer);
						timer = setTimeout(set, 9);
					};
				})());
			}
		})();
		return;
	}
	
	var isOver = (webshims.cfg.forms.placeholderType == 'over');
	var isResponsive = (webshims.cfg.forms.responsivePlaceholder);
	var polyfillElements = ['textarea'];
	if(!Modernizr.input.placeholder || bustedPlaceholder){
		polyfillElements.push('input');
	}
	
	var setSelection = function(elem){
		try {
			if(elem.setSelectionRange){
				elem.setSelectionRange(0, 0);
				return true;
			} else if(elem.createTextRange){
				var range = elem.createTextRange();
				range.collapse(true);
				range.moveEnd('character', 0);
				range.moveStart('character', 0);
				range.select();
				return true;
			}
		} catch(er){}
	};
	
	var hidePlaceholder = function(elem, data, value, _onFocus){
			if(value === false){
				value = $.prop(elem, 'value');
			}
			
			if(!isOver && elem.type != 'password'){
				if(!value && _onFocus && setSelection(elem)){
					var selectTimer  = setTimeout(function(){
						setSelection(elem);
					}, 9);
					$(elem)
						.off('.placeholderremove')
						.on({
							'keydown.placeholderremove keypress.placeholderremove paste.placeholderremove input.placeholderremove': function(e){
								if(e && (e.keyCode == 17 || e.keyCode == 16)){return;}
								elem.value = $.prop(elem, 'value');
								data.box.removeClass('placeholder-visible');
								clearTimeout(selectTimer);
								$(elem).unbind('.placeholderremove');
							},
							'mousedown.placeholderremove drag.placeholderremove select.placeholderremove': function(e){
								setSelection(elem);
								clearTimeout(selectTimer);
								selectTimer = setTimeout(function(){
									setSelection(elem);
								}, 9);
							},
							'blur.placeholderremove': function(){
								clearTimeout(selectTimer);
								$(elem).unbind('.placeholderremove');
							}
						})
					;
					return;
				} else if(!_onFocus && !value && elem.value){ //especially on submit
					elem.value = value;
				}
			} else if(!value && _onFocus){
				$(elem)
					.off('.placeholderremove')
					.on({
						'keydown.placeholderremove keypress.placeholderremove paste.placeholderremove input.placeholderremove': function(e){
							if(e && (e.keyCode == 17 || e.keyCode == 16)){return;}
							data.box.removeClass('placeholder-visible');
							$(elem).unbind('.placeholderremove');
						},
						'blur.placeholderremove': function(){
							$(elem).unbind('.placeholderremove');
						}
					})
				;
				return;
			}
			data.box.removeClass('placeholder-visible');
		},
		showPlaceholder = function(elem, data, placeholderTxt){
			if(placeholderTxt === false){
				placeholderTxt = $.prop(elem, 'placeholder');
			}
			
			if(!isOver && elem.type != 'password'){
				elem.value = placeholderTxt;
			}
			data.box.addClass('placeholder-visible');
		},
		changePlaceholderVisibility = function(elem, value, placeholderTxt, data, type){
			if(!data){
				data = $.data(elem, 'placeHolder');
				if(!data){return;}
			}
			$(elem).unbind('.placeholderremove');
			
			if(value === false){
				value = $.prop(elem, 'value');
			}
			
			if(!value && (type == 'focus' || (!type && $(elem).is(':focus')))){
				if(elem.type == 'password' || isOver || $(elem).hasClass('placeholder-visible')){
					hidePlaceholder(elem, data, '', true);
				}
				return;
			}
			
			if(value){
				hidePlaceholder(elem, data, value);
				return;
			}
			if(placeholderTxt === false){
				placeholderTxt = $.attr(elem, 'placeholder') || '';
			}
			if(placeholderTxt && !value){
				showPlaceholder(elem, data, placeholderTxt);
			} else {
				hidePlaceholder(elem, data, value);
			}
		},
		hasLabel = function(elem){
			elem = $(elem);
			return !!(elem.prop('title') || elem.attr('aria-labelledby') || elem.attr('aria-label') || elem.jProp('labels').length);
		},
		createPlaceholder = function(elem){
			elem = $(elem);
			return $( hasLabel(elem) ? '<span class="placeholder-text"></span>' : '<label for="'+ elem.prop('id') +'" class="placeholder-text"></label>');
		},
		pHolder = (function(){
			var delReg 	= /\n|\r|\f|\t/g,
				allowedPlaceholder = {
					text: 1,
					search: 1,
					url: 1,
					email: 1,
					password: 1,
					tel: 1,
					number: 1
				}
			;
			
			if(webshims.modules["form-number-date-ui"].loaded){
				delete allowedPlaceholder.number;
			}
			
			return {
				create: function(elem){
					var data = $.data(elem, 'placeHolder');
					var form;
					var responsiveElem;
					if(data){return data;}
					data = $.data(elem, 'placeHolder', {});
					
					$(elem).on('focus.placeholder blur.placeholder', function(e){
						changePlaceholderVisibility(this, false, false, data, e.type );
						data.box[e.type == 'focus' ? 'addClass' : 'removeClass']('placeholder-focused');
					});
					
					if((form = $.prop(elem, 'form'))){
						$(form).on('reset.placeholder', function(e){
							setTimeout(function(){
								changePlaceholderVisibility(elem, false, false, data, e.type );
							}, 0);
						});
					}
					
					if(elem.type == 'password' || isOver){
						data.text = createPlaceholder(elem);
						if(isResponsive || $(elem).is('.responsive-width') || (elem.currentStyle || {width: ''}).width.indexOf('%') != -1){
							responsiveElem = true;
							data.box = data.text;
						} else {
							data.box = $(elem)
								.wrap('<span class="placeholder-box placeholder-box-'+ (elem.nodeName || '').toLowerCase() +' placeholder-box-'+$.css(elem, 'float')+'" />')
								.parent()
							;
						}
						data.text
							.insertAfter(elem)
							.on('mousedown.placeholder', function(){
								changePlaceholderVisibility(this, false, false, data, 'focus');
								try {
									setTimeout(function(){
										elem.focus();
									}, 0);
								} catch(e){}
								return false;
							})
						;
						
						
						$.each(['lineHeight', 'fontSize', 'fontFamily', 'fontWeight'], function(i, style){
							var prop = $.css(elem, style);
							if(data.text.css(style) != prop){
								data.text.css(style, prop);
							}
						});
						$.each(['Left', 'Top'], function(i, side){
							var size = (parseInt($.css(elem, 'padding'+ side), 10) || 0) + Math.max((parseInt($.css(elem, 'margin'+ side), 10) || 0), 0) + (parseInt($.css(elem, 'border'+ side +'Width'), 10) || 0);
							data.text.css('padding'+ side, size);
						});
						
						$(elem)
							.onWSOff('updateshadowdom', function(){
								var height, width; 
								if((width = elem.offsetWidth) || (height = elem.offsetHeight)){
									data.text
										.css({
											width: width,
											height: height
										})
										.css($(elem).position())
									;
								}
							}, true)
						;
						
					} else {
						var reset = function(e){
							if($(elem).hasClass('placeholder-visible')){
								hidePlaceholder(elem, data, '');
								if(e && e.type == 'submit'){
									setTimeout(function(){
										if(e.isDefaultPrevented()){
											changePlaceholderVisibility(elem, false, false, data );
										}
									}, 9);
								}
							}
						};
						
						$(window).on('beforeunload', reset);
						data.box = $(elem);
						if(form){
							$(form).submit(reset);
						}
					}
					
					return data;
				},
				update: function(elem, val){
					var type = ($.attr(elem, 'type') || $.prop(elem, 'type') || '').toLowerCase();
					if(!allowedPlaceholder[type] && !$.nodeName(elem, 'textarea')){
						webshims.warn('placeholder not allowed on input[type="'+type+'"], but it is a good fallback :-)');
						return;
					}
					
					
					var data = pHolder.create(elem);
					if(data.text){
						data.text.text(val);
					}
					
					changePlaceholderVisibility(elem, false, val, data);
				}
			};
		})()
	;
	
	$.webshims.publicMethods = {
		pHolder: pHolder
	};
	polyfillElements.forEach(function(nodeName){
		var desc = webshims.defineNodeNameProperty(nodeName, 'placeholder', {
			attr: {
				set: function(val){
					var elem = this;
					if(bustedPlaceholder){
						webshims.data(elem, 'bustedPlaceholder', val);
						elem.placeholder = '';
					} else {
						webshims.contentAttr(elem, 'placeholder', val);
					}
					pHolder.update(elem, val);
				},
				get: function(){
					var placeholder;
					if(bustedPlaceholder){
						placeholder = webshims.data(this, 'bustedPlaceholder');
					}
					return  placeholder || webshims.contentAttr(this, 'placeholder');
				}
			},
			reflect: true,
			initAttr: true
		});
	});
	
	
	polyfillElements.forEach(function(name){
		var placeholderValueDesc =  {};
		var desc;
		['attr', 'prop'].forEach(function(propType){
			placeholderValueDesc[propType] = {
				set: function(val){
					var elem = this;
					var placeholder;
					if(bustedPlaceholder){
						placeholder = webshims.data(elem, 'bustedPlaceholder');
					}
					if(!placeholder){
						placeholder = webshims.contentAttr(elem, 'placeholder');
					}
					$.removeData(elem, 'cachedValidity');
					var ret = desc[propType]._supset.call(elem, val);
					if(placeholder && 'value' in elem){
						changePlaceholderVisibility(elem, val, placeholder);
					}
					return ret;
				},
				get: function(){
					var elem = this;
					return $(elem).hasClass('placeholder-visible') ? '' : desc[propType]._supget.call(elem);
				}
			};
		});
		desc = webshims.defineNodeNameProperty(name, 'value', placeholderValueDesc);
	});
	
})();

	(function(){
		var doc = document;	
		if( 'value' in document.createElement('output') ){return;}
		
		webshims.defineNodeNameProperty('output', 'value', {
			prop: {
				set: function(value){
					var setVal = $.data(this, 'outputShim');
					if(!setVal){
						setVal = outputCreate(this);
					}
					setVal(value);
				},
				get: function(){
					return webshims.contentAttr(this, 'value') || $(this).text() || '';
				}
			}
		});
		
		
		webshims.onNodeNamesPropertyModify('input', 'value', function(value, boolVal, type){
			if(type == 'removeAttr'){return;}
			var setVal = $.data(this, 'outputShim');
			if(setVal){
				setVal(value);
			}
		});
		
		var outputCreate = function(elem){
			if(elem.getAttribute('aria-live')){return;}
			elem = $(elem);
			var value = (elem.text() || '').trim();
			var	id 	= elem.prop('id');
			var	htmlFor = elem.attr('for');
			var shim = $('<input class="output-shim" type="text" disabled name="'+ (elem.attr('name') || '')+'" value="'+value+'" style="display: none !important;" />').insertAfter(elem);
			var form = shim[0].form || doc;
			var setValue = function(val){
				shim[0].value = val;
				val = shim[0].value;
				elem.text(val);
				webshims.contentAttr(elem[0], 'value', val);
			};
			
			elem[0].defaultValue = value;
			webshims.contentAttr(elem[0], 'value', value);
			
			elem.attr({'aria-live': 'polite'});
			if(id){
				shim.attr('id', id);
				elem.attr('aria-labelledby', elem.jProp('labels').map(function(){
					return webshims.getID(this);
				}).get().join(' '));
			}
			if(htmlFor){
				id = webshims.getID(elem);
				htmlFor.split(' ').forEach(function(control){
					control = document.getElementById(control);
					if(control){
						control.setAttribute('aria-controls', id);
					}
				});
			}
			elem.data('outputShim', setValue );
			shim.data('outputShim', setValue );
			return setValue;
		};
						
		webshims.addReady(function(context, contextElem){
			$('output', context).add(contextElem.filter('output')).each(function(){
				outputCreate(this);
			});
		});
		
		/*
		 * Implements input event in all browsers
		 */
		(function(){
			var noInputTriggerEvts = {updateInput: 1, input: 1},
				noInputTypes = {
					radio: 1,
					checkbox: 1,
					submit: 1,
					button: 1,
					image: 1,
					reset: 1,
					file: 1
					
					//pro forma
					,color: 1
					//,range: 1
				},
				observe = function(input){
					var timer,
						lastVal = input.prop('value'),
						trigger = function(e){
							//input === null
							if(!input){return;}
							var newVal = input.prop('value');
							if(newVal !== lastVal){
								lastVal = newVal;
								if(!e || !noInputTriggerEvts[e.type]){
									webshims.triggerInlineForm && webshims.triggerInlineForm(input[0], 'input');
								}
							}
						},
						extraTimer,
						extraTest = function(){
							clearTimeout(extraTimer);
							extraTimer = setTimeout(trigger, 9);
						},
						unbind = function(){
							input.unbind('focusout', unbind).unbind('keyup keypress keydown paste cut', extraTest).unbind('input change updateInput', trigger);
							clearInterval(timer);
							setTimeout(function(){
								trigger();
								input = null;
							}, 1);
							
						}
					;
					
					clearInterval(timer);
					timer = setInterval(trigger, 200);
					extraTest();
					input.on({
						'keyup keypress keydown paste cut': extraTest,
						focusout: unbind,
						'input updateInput change': trigger
					});
				}
			;
			if($.event.customEvent){
				$.event.customEvent.updateInput = true;
			} 
			
			$(doc)
				.on('focusin', function(e){
					if( e.target && !e.target.readOnly && !e.target.disabled && (e.target.nodeName || '').toLowerCase() == 'input' && !noInputTypes[e.target.type] && !(webshims.data(e.target, 'implemented') || {}).inputwidgets){
						observe($(e.target));
					}
				})
			;
		})();
	})();

}); //webshims.ready end
}//end formvalidation

jQuery.webshims.register('form-message', function($, webshims, window, document, undefined, options){
	"use strict";
	var validityMessages = webshims.validityMessages;
	
	var implementProperties = (options.overrideMessages || options.customMessages) ? ['customValidationMessage'] : [];
	
	validityMessages.en = $.extend(true, {
		typeMismatch: {
			defaultMessage: 'Please enter a valid value.',
			email: 'Please enter an email address.',
			url: 'Please enter a URL.',
			number: 'Please enter a number.',
			date: 'Please enter a date.',
			time: 'Please enter a time.',
			range: 'Invalid input.',
			month: 'Please enter a valid value.',
			"datetime-local": 'Please enter a datetime.'
		},
		rangeUnderflow: {
			defaultMessage: 'Value must be greater than or equal to {%min}.'
		},
		rangeOverflow: {
			defaultMessage: 'Value must be less than or equal to {%max}.'
		},
		stepMismatch: 'Invalid input.',
		tooLong: 'Please enter at most {%maxlength} character(s). You entered {%valueLen}.',
		patternMismatch: 'Invalid input. {%title}',
		valueMissing: {
			defaultMessage: 'Please fill out this field.',
			checkbox: 'Please check this box if you want to proceed.'
		}
	}, (validityMessages.en || validityMessages['en-US'] || {}));
	
	if(typeof validityMessages['en'].valueMissing == 'object'){
		['select', 'radio'].forEach(function(type){
			validityMessages.en.valueMissing[type] = 'Please select an option.';
		});
	}
	if(typeof validityMessages.en.rangeUnderflow == 'object'){
		['date', 'time', 'datetime-local', 'month'].forEach(function(type){
			validityMessages.en.rangeUnderflow[type] = 'Value must be at or after {%min}.';
		});
	}
	if(typeof validityMessages.en.rangeOverflow == 'object'){
		['date', 'time', 'datetime-local', 'month'].forEach(function(type){
			validityMessages.en.rangeOverflow[type] = 'Value must be at or before {%max}.';
		});
	}
	
	validityMessages['en-US'] = validityMessages['en-US'] || validityMessages.en;
	validityMessages[''] = validityMessages[''] || validityMessages['en-US'];
	
	validityMessages.de = $.extend(true, {
		typeMismatch: {
			defaultMessage: '{%value} ist in diesem Feld nicht zulässig.',
			email: '{%value} ist keine gültige E-Mail-Adresse.',
			url: '{%value} ist kein(e) gültige(r) Webadresse/Pfad.',
			number: '{%value} ist keine Nummer.',
			date: '{%value} ist kein Datum.',
			time: '{%value} ist keine Uhrzeit.',
			month: '{%value} ist in diesem Feld nicht zulässig.',
			range: '{%value} ist keine Nummer.',
			"datetime-local": '{%value} ist kein Datum-Uhrzeit Format.'
		},
		rangeUnderflow: {
			defaultMessage: '{%value} ist zu niedrig. {%min} ist der unterste Wert, den Sie benutzen können.'
		},
		rangeOverflow: {
			defaultMessage: '{%value} ist zu hoch. {%max} ist der oberste Wert, den Sie benutzen können.'
		},
		stepMismatch: 'Der Wert {%value} ist in diesem Feld nicht zulässig. Hier sind nur bestimmte Werte zulässig. {%title}',
		tooLong: 'Der eingegebene Text ist zu lang! Sie haben {%valueLen} Zeichen eingegeben, dabei sind {%maxlength} das Maximum.',
		patternMismatch: '{%value} hat für dieses Eingabefeld ein falsches Format. {%title}',
		valueMissing: {
			defaultMessage: 'Bitte geben Sie einen Wert ein.',
			checkbox: 'Bitte aktivieren Sie das Kästchen.'
		}
	}, (validityMessages.de || {}));
	
	if(typeof validityMessages.de.valueMissing == 'object'){
		['select', 'radio'].forEach(function(type){
			validityMessages.de.valueMissing[type] = 'Bitte wählen Sie eine Option aus.';
		});
	}
	if(typeof validityMessages.de.rangeUnderflow == 'object'){
		['date', 'time', 'datetime-local', 'month'].forEach(function(type){
			validityMessages.de.rangeUnderflow[type] = '{%value} ist zu früh. {%min} ist die früheste Zeit, die Sie benutzen können.';
		});
	}
	if(typeof validityMessages.de.rangeOverflow == 'object'){
		['date', 'time', 'datetime-local', 'month'].forEach(function(type){
			validityMessages.de.rangeOverflow[type] = '{%value} ist zu spät. {%max} ist die späteste Zeit, die Sie benutzen können.';
		});
	}
	
	var currentValidationMessage =  validityMessages[''];
	var getMessageFromObj = function(message, elem){
		if(message && typeof message !== 'string'){
			message = message[ $.prop(elem, 'type') ] || message[ (elem.nodeName || '').toLowerCase() ] || message[ 'defaultMessage' ];
		}
		return message || '';
	};
	var valueVals = {
		value: 1,
		min: 1,
		max: 1
	};
	
	webshims.createValidationMessage = function(elem, name){
		var spinner;
		var message = getMessageFromObj(currentValidationMessage[name], elem);
		
		if(!message){
			message = getMessageFromObj(validityMessages[''][name], elem) || $.prop(elem, 'validationMessage');
			webshims.info('could not find errormessage for: '+ name +' / '+ $.prop(elem, 'type') +'. in language: '+$.webshims.activeLang());
		}
		if(message){
			['value', 'min', 'max', 'title', 'maxlength', 'label'].forEach(function(attr){
				if(message.indexOf('{%'+attr) === -1){return;}
				var val = ((attr == 'label') ? $.trim($('label[for="'+ elem.id +'"]', elem.form).text()).replace(/\*$|:$/, '') : $.prop(elem, attr)) || '';
				if(name == 'patternMismatch' && attr == 'title' && !val){
					webshims.error('no title for patternMismatch provided. Always add a title attribute.');
				}
				if(valueVals[attr]){
					if(!spinner){
						spinner = $(elem).getShadowElement().data('wsspinner');
					}
					if(spinner && spinner.formatValue){
						val = spinner.formatValue(val, false);
					}
				}
				message = message.replace('{%'+ attr +'}', val);
				if('value' == attr){
					message = message.replace('{%valueLen}', val.length);
				}
				
			});
		}
		
		return message || '';
	};
	
	
	if(webshims.bugs.validationMessage || !Modernizr.formvalidation || webshims.bugs.bustedValidity){
		implementProperties.push('validationMessage');
	}
	
	webshims.activeLang({
		langObj: validityMessages, 
		module: 'form-core', 
		callback: function(langObj){
			
			currentValidationMessage = langObj;
		}
	});
	
	implementProperties.forEach(function(messageProp){
		webshims.defineNodeNamesProperty(['fieldset', 'output', 'button'], messageProp, {
			prop: {
				value: '',
				writeable: false
			}
		});
		['input', 'select', 'textarea'].forEach(function(nodeName){
			var desc = webshims.defineNodeNameProperty(nodeName, messageProp, {
				prop: {
					get: function(){
						var elem = this;
						var message = '';
						if(!$.prop(elem, 'willValidate')){
							return message;
						}
						
						var validity = $.prop(elem, 'validity') || {valid: 1};
						
						if(validity.valid){return message;}
						message = webshims.getContentValidationMessage(elem, validity);
						
						if(message){return message;}
						
						if(validity.customError && elem.nodeName){
							message = (Modernizr.formvalidation && !webshims.bugs.bustedValidity && desc.prop._supget) ? desc.prop._supget.call(elem) : webshims.data(elem, 'customvalidationMessage');
							if(message){return message;}
						}
						$.each(validity, function(name, prop){
							if(name == 'valid' || !prop){return;}
							
							message = webshims.createValidationMessage(elem, name);
							if(message){
								return false;
							}
						});
						return message || '';
					},
					writeable: false
				}
			});
		});
		
	});
});
jQuery.webshims.register('form-datalist', function($, webshims, window, document, undefined, options){
	"use strict";
	var doc = document;

	/*
	 * implement propType "element" currently only used for list-attribute (will be moved to dom-extend, if needed)
	 */
	webshims.propTypes.element = function(descs){
		webshims.createPropDefault(descs, 'attr');
		if(descs.prop){return;}
		descs.prop = {
			get: function(){
				var elem = $.attr(this, 'list');
				if(elem){
					elem = document.getElementById(elem);
					if(elem && descs.propNodeName && !$.nodeName(elem, descs.propNodeName)){
						elem = null;
					}
				}
				return elem || null;
			},
			writeable: false
		};
	};
	
	
	/*
	 * Implements datalist element and list attribute
	 */
	
	(function(){
		var formsCFG = $.webshims.cfg.forms;
		var listSupport = Modernizr.input.list;
		if(listSupport && !formsCFG.customDatalist){return;}
		
			var initializeDatalist =  function(){
				
				
			if(!listSupport){
				webshims.defineNodeNameProperty('datalist', 'options', {
					prop: {
						writeable: false,
						get: function(){
							var elem = this;
							var select = $('select', elem);
							var options;
							if(select[0]){
								options = select[0].options;
							} else {
								options = $('option', elem).get();
								if(options.length){
									webshims.warn('you should wrap your option-elements for a datalist in a select element to support IE and other old browsers.');
								}
							}
							return options;
						}
					}
				});
			}
				
			var inputListProto = {
				//override autocomplete
				autocomplete: {
					attr: {
						get: function(){
							var elem = this;
							var data = $.data(elem, 'datalistWidget');
							if(data){
								return data._autocomplete;
							}
							return ('autocomplete' in elem) ? elem.autocomplete : elem.getAttribute('autocomplete');
						},
						set: function(value){
							var elem = this;
							var data = $.data(elem, 'datalistWidget');
							if(data){
								data._autocomplete = value;
								if(value == 'off'){
									data.hideList();
								}
							} else {
								if('autocomplete' in elem){
									elem.autocomplete = value;
								} else {
									elem.setAttribute('autocomplete', value);
								}
							}
						}
					}
				}
			};
			
			if(formsCFG.customDatalist && (!listSupport || !('selectedOption' in $('<input />')[0]))){
				//currently not supported x-browser (FF4 has not implemented and is not polyfilled )
				inputListProto.selectedOption = {
					prop: {
						writeable: false,
						get: function(){
							var elem = this;
							var list = $.prop(elem, 'list');
							var ret = null;
							var value, options;
							if(!list){return ret;}
							value = $.prop(elem, 'value');
							if(!value){return ret;}
							options = $.prop(list, 'options');
							if(!options.length){return ret;}
							$.each(options, function(i, option){
								if(value == $.prop(option, 'value')){
									ret = option;
									return false;
								}
							});
							return ret;
						}
					}
				};
			}
			
			if(!listSupport){
				
				inputListProto['list'] = {
					attr: {
						get: function(){
							var val = webshims.contentAttr(this, 'list');
							return (val == null) ? undefined : val;
						},
						set: function(value){
							var elem = this;
							webshims.contentAttr(elem, 'list', value);
							webshims.objectCreate(shadowListProto, undefined, {input: elem, id: value, datalist: $.prop(elem, 'list')});
							$(elem).triggerHandler('listdatalistchange');
						}
					},
					initAttr: true,
					reflect: true,
					propType: 'element',
					propNodeName: 'datalist'
				};
			} else {
				//options only return options, if option-elements are rooted: but this makes this part of HTML5 less backwards compatible
				if(!($('<datalist><select><option></option></select></datalist>').prop('options') || []).length ){
					webshims.defineNodeNameProperty('datalist', 'options', {
						prop: {
							writeable: false,
							get: function(){
								var options = this.options || [];
								if(!options.length){
									var elem = this;
									var select = $('select', elem);
									if(select[0] && select[0].options && select[0].options.length){
										options = select[0].options;
									}
								}
								return options;
							}
						}
					});
				}
				inputListProto['list'] = {
					attr: {
						get: function(){
							var val = webshims.contentAttr(this, 'list');
							if(val != null){
								$.data(this, 'datalistListAttr', val);
								this.removeAttribute('list');
							} else {
								val = $.data(this, 'datalistListAttr');
							}
							
							return (val == null) ? undefined : val;
						},
						set: function(value){
							var elem = this;
							$.data(elem, 'datalistListAttr', value);
							webshims.objectCreate(shadowListProto, undefined, {input: elem, id: value, datalist: $.prop(elem, 'list')});
							$(elem).triggerHandler('listdatalistchange');
						}
					},
					initAttr: true,
					reflect: true,
					propType: 'element',
					propNodeName: 'datalist'
				};
			}
			
			webshims.defineNodeNameProperties('input', inputListProto);
			
			webshims.addReady(function(context, contextElem){
				contextElem
					.filter('datalist > select, datalist, datalist > option, datalist > select > option')
					.closest('datalist')
					.each(function(){
						$(this).triggerHandler('updateDatalist');
					})
				;
			});
		};
		
		
		/*
		 * ShadowList
		 */
		var listidIndex = 0;
		var noDatalistSupport = {
			submit: 1,
			button: 1,
			reset: 1, 
			hidden: 1,
			
			range: 1,
			date: 1,
			month: 1
		};
		if(webshims.modules["form-number-date-ui"].loaded){
			$.extend(noDatalistSupport, {
				number: 1,
				time: 1
			});
		}

		var globStoredOptions = {};
		var getStoredOptions = function(name){
			if(!name){return [];}
			if(globStoredOptions[name]){
				return globStoredOptions[name];
			}
			var data;
			try {
				data = JSON.parse(localStorage.getItem('storedDatalistOptions'+name));
			} catch(e){}
			globStoredOptions[name] = data || [];
			return data || [];
		};
		var storeOptions = function(name, val){
			if(!name){return;}
			val = val || [];
			try {
				localStorage.setItem( 'storedDatalistOptions'+name, JSON.stringify(val) );
			} catch(e){}
		};
		
		var getText = function(elem){
			return (elem.textContent || elem.innerText || $.text([ elem ]) || '');
		};
		var lReg = /</g;
		var gReg = />/g;
		
		var shadowListProto = {
			_create: function(opts){
				
				if(noDatalistSupport[$.prop(opts.input, 'type')] || noDatalistSupport[$.attr(opts.input, 'type')]){return;}
				var datalist = opts.datalist;
				var data = $.data(opts.input, 'datalistWidget');
				if(datalist && data && data.datalist !== datalist){
					data.datalist = datalist;
					data.id = opts.id;
					
					
					$(data.datalist)
						.off('updateDatalist.datalistWidget')
						.on('updateDatalist.datalistWidget', $.proxy(data, '_resetListCached'))
					;
					
					data._resetListCached();
					return;
				} else if(!datalist){
					if(data){
						data.destroy();
					}
					return;
				} else if(data && data.datalist === datalist){
					return;
				}
				listidIndex++;
				var that = this;
				this.hideList = $.proxy(that, 'hideList');
				
				this.datalist = datalist;
				this.id = opts.id;
				this.hasViewableData = true;
				this._autocomplete = $.attr(opts.input, 'autocomplete');
				$.data(opts.input, 'datalistWidget', this);
				
				this.popover = webshims.objectCreate(webshims.wsPopover, {}, options.datalistPopover);
				this.shadowList = this.popover.element.addClass('datalist-polyfill');
				
				
				this.index = -1;
				this.input = opts.input;
				this.arrayOptions = [];
				
				this.shadowList
					.delegate('li', 'mouseenter.datalistWidget mousedown.datalistWidget click.datalistWidget', function(e){
						var items = $('li:not(.hidden-item)', that.shadowList);
						var select = (e.type == 'mousedown' || e.type == 'click');
						that.markItem(items.index(e.currentTarget), select, items);
						if(e.type == 'click'){
							that.hideList();
							if(formsCFG.customDatalist){
								$(opts.input).getNativeElement().trigger('datalistselect');
							}
						}
						return (e.type != 'mousedown');
					})
				;
				
				opts.input.setAttribute('autocomplete', 'off');
				
				$(opts.input)
					.attr({
						//role: 'combobox',
						'aria-haspopup': 'true'
					})
					.on({
						'input.datalistWidget': function(){
							if(!that.triggeredByDatalist){
								that.changedValue = false;
								that.showHideOptions();
							}
						},
						'keydown.datalistWidget': function(e){
							var keyCode = e.keyCode;
							var activeItem;
							var items;
							if(keyCode == 40 && !that.showList()){
								that.markItem(that.index + 1, true);
								return false;
							}
							
							if(!that.popover.isVisible){return;}
							
							 
							if(keyCode == 38){
								that.markItem(that.index - 1, true);
								return false;
							} 
							if(!e.shiftKey && (keyCode == 33 || keyCode == 36)){
								that.markItem(0, true);
								return false;
							} 
							if(!e.shiftKey && (keyCode == 34 || keyCode == 35)){
								items = $('li:not(.hidden-item)', that.shadowList);
								that.markItem(items.length - 1, true, items);
								return false;
							} 
							if(keyCode == 13 || keyCode == 27){
								if (keyCode == 13){
									activeItem = $('li.active-item:not(.hidden-item)', that.shadowList);
									that.changeValue( $('li.active-item:not(.hidden-item)', that.shadowList) );
								}
								that.hideList();
								if(formsCFG.customDatalist && activeItem && activeItem[0]){
									$(opts.input).getNativeElement().trigger('datalistselect');
								}
								return false;
							}
						},
						'focus.datalistWidget': function(){
							if($(this).hasClass('list-focus')){
								that.showList();
							}
						},
						'mousedown.datalistWidget': function(){
							if($(this).is(':focus')){
								that.showList();
							}
						}
					})
				;
				
				
				$(this.datalist)
					.off('updateDatalist.datalistWidget')
					.on('updateDatalist.datalistWidget', $.proxy(this, '_resetListCached'))
					.on('remove', function(e){
						if(!e.originalEvent){
							that.detroy();
						}
					})
				;
				
				this._resetListCached();
				
				if(opts.input.form && (opts.input.name || opts.input.id)){
					$(opts.input.form).on('submit.datalistWidget'+opts.input.id, function(){
						if(!$(opts.input).hasClass('no-datalist-cache') && that._autocomplete != 'off'){
							var val = $.prop(opts.input, 'value');
							var name = (opts.input.name || opts.input.id) + $.prop(opts.input, 'type');
							if(!that.storedOptions){
								that.storedOptions = getStoredOptions( name );
							}
							if(val && that.storedOptions.indexOf(val) == -1){
								that.storedOptions.push(val);
								storeOptions(name, that.storedOptions );
							}
						}
					});
				}
				$(window).on('unload.datalist'+this.id+' beforeunload.datalist'+this.id, function(){
					that.destroy();
				});
			},
			destroy: function(){
				var autocomplete = $.attr(this.input, 'autocomplete');
				$(this.input)
					.off('.datalistWidget')
					.removeData('datalistWidget')
				;
				this.shadowList.remove();
				$(document).off('.datalist'+this.id);
				$(window).off('.datalist'+this.id);
				if(this.input.form && this.input.id){
					$(this.input.form).off('submit.datalistWidget'+this.input.id);
				}
				this.input.removeAttribute('aria-haspopup');
				if(autocomplete === undefined){
					this.input.removeAttribute('autocomplete');
				} else {
					$(this.input).attr('autocomplete', autocomplete);
				}
			},
			_resetListCached: function(e){
				var that = this;
				var forceShow;
				this.needsUpdate = true;
				this.lastUpdatedValue = false;
				this.lastUnfoundValue = '';

				if(!this.updateTimer){
					if(window.QUnit || (forceShow = ($(that.input).is(':focus') && ($(that.input).hasClass('list-focus') || $.prop(that.input, 'value'))) )){
						that.updateListOptions(forceShow);
					} else {
						webshims.ready('WINDOWLOAD', function(){
							that.updateTimer = setTimeout(function(){
								that.updateListOptions();
								that = null;
								listidIndex = 1;
							}, 200 + (100 * listidIndex));
						});
					}
				}
			},
			updateListOptions: function(_forceShow){
				this.needsUpdate = false;
				clearTimeout(this.updateTimer);
				this.updateTimer = false;
				
				this.searchStart = formsCFG.customDatalist && $(this.input).hasClass('search-start');
				this.addMarkElement = options.addMark || $(this.input).hasClass('mark-option-text');
				
				var list = [];
				
				var values = [];
				var allOptions = [];
				var rElem, rItem, rOptions, rI, rLen, item, value;
				for(rOptions = $.prop(this.datalist, 'options'), rI = 0, rLen = rOptions.length; rI < rLen; rI++){
					rElem = rOptions[rI];
					if(!rElem.disabled && (value = $(rElem).val())){
						rItem = {
							value: value.replace(lReg, '&lt;').replace(gReg, '&gt;'),
							label: $.trim($.attr(rElem, 'label') || getText(rElem)).replace(lReg, '&lt;').replace(gReg, '&gt;'),
							className: rElem.className || ''
						};
						
						if(rItem.label){
							rItem.className += ' has-option-label';
						}
						values.push(rItem.value);
						allOptions.push(rItem);
					}
				}
				
				if(!this.storedOptions){
					this.storedOptions = ($(this.input).hasClass('no-datalist-cache') || this._autocomplete == 'off') ? [] : getStoredOptions((this.input.name || this.input.id) + $.prop(this.input, 'type'));
				}
				
				this.storedOptions.forEach(function(val, i){
					if(values.indexOf(val) == -1){
						allOptions.push({value: val, label: '', className: 'stored-suggest', style: ''});
					}
				});
				
				for(rI = 0, rLen = allOptions.length; rI < rLen; rI++){
					item = allOptions[rI];
					list[rI] = '<li class="'+ item.className +'" tabindex="-1" role="listitem">'+ this.getOptionContent(item) +'</li>';
				}
				
				this.arrayOptions = allOptions;
				this.popover.contentElement.html('<div class="datalist-box"><ul role="list">'+ list.join("\n") +'</ul></div>');
				
				
				if(_forceShow || this.popover.isVisible){
					this.showHideOptions();
				}
			},
			getOptionContent: function(item){
				var content = '';
				if(options.getOptionContent){
					content = options.apply(this, arguments) || '';
				} else {
					content = '<span class="option-value">'+ item.value +'</span>';
					if(item.label){
						content += ' <span class="option-label">'+ item.label +'</span>';
					}
				}
				return content;
			},
			showHideOptions: function(_fromShowList){
				var value = $.prop(this.input, 'value').toLowerCase();

				//first check prevent infinite loop, second creates simple lazy optimization
				if(value === this.lastUpdatedValue){
					return;
				} 
				if(this.lastUnfoundValue && value.indexOf(this.lastUnfoundValue) === 0){
					this.hideList();
					return;
				}
				
				
				this.lastUpdatedValue = value;
				var found = false;
				var startSearch = this.searchStart;
				var lis = $('li', this.shadowList);
				var that = this;
				if(value){
					
					this.arrayOptions.forEach(function(item, i){
						var search, searchIndex, foundName;
						if(!('lowerValue' in item)){
							item.lowerValue = item.value.toLowerCase();
							if(item.label && item.label != item.value ){
								item.lowerLabel = item.label.toLowerCase();
							}
						}
						
						if(value != item.lowerValue && item.lowerLabel != value){
							searchIndex = item.lowerValue.indexOf(value);
							search = startSearch ? !searchIndex : searchIndex !== -1;
							if(search){
								foundName = 'value';
							} else if(item.lowerLabel){
								searchIndex = item.lowerLabel.indexOf(value);
								search = startSearch ? !searchIndex : searchIndex !== -1;
								foundName = 'label';
							}
						}
						
						if(search){
							that.addMark($(lis[i]).removeClass('hidden-item'), item, foundName, searchIndex, value.length);
							found = true;
						} else {
							$(lis[i]).addClass('hidden-item');
						}
					});
				} else if(lis.length) {
					this.removeMark(lis.removeClass('hidden-item'));
					found = true;
				}
				
				this.hasViewableData = found;
				if(!_fromShowList && found){
					this.showList();
				}
				
				if(!found){
					this.lastUnfoundValue = value;
					this.hideList();
				} else {
					this.lastUnfoundValue = false;
				}
			},
			otherType: {
				value: 'label',
				label: 'value'
			},
			addMark: function(elem, item, prop, start, length){
				if(this.addMarkElement){
					var text = item[prop].substr(start, length);
					text = item[prop].replace(text ,'<mark>'+ text +'</mark>');
					$('.option-'+ this.otherType[prop] +' > mark', elem).each(this._replaceMark);
					$('.option-'+prop, elem).html(text);
					
				}
			},
			_replaceMark: function(){
				var content = $(this).html();
				$(this).replaceWith(content);
			},
			removeMark: function(lis){
				if(this.addMarkElement){
					$('mark', lis).each(this._replaceMark);
				}
			},
			showList: function(){
				if(this.popover.isVisible){return false;}
				if(this.needsUpdate){
					this.updateListOptions();
				}
				this.showHideOptions(true);
				if(!this.hasViewableData){return false;}
				var that = this;
				
				that.shadowList.find('li.active-item').removeClass('active-item');
				that.popover.show(this.input);
				
				
				return true;
			},
			hideList: function(){
				if(!this.popover.isVisible){return false;}
				var that = this;
				
				
				this.popover.hide();
				that.shadowList.removeClass('datalist-visible list-item-active');
				that.index = -1;
				if(that.changedValue){
					that.triggeredByDatalist = true;
					$(that.input).trigger('input').trigger('change');
					that.changedValue = false;
					that.triggeredByDatalist = false;
				}
				
				return true;
			},
			scrollIntoView: function(elem){
				var ul = $('ul', this.shadowList);
				var div = $('div.datalist-box', this.shadowList);
				var elemPos = elem.position();
				var containerHeight;
				elemPos.top -=  (parseInt(ul.css('paddingTop'), 10) || 0) + (parseInt(ul.css('marginTop'), 10) || 0) + (parseInt(ul.css('borderTopWidth'), 10) || 0);
				if(elemPos.top < 0){
					div.scrollTop( div.scrollTop() + elemPos.top - 2);
					return;
				}
				elemPos.top += elem.outerHeight();
				containerHeight = div.height();
				if(elemPos.top > containerHeight){
					div.scrollTop( div.scrollTop() + (elemPos.top - containerHeight) + 2);
				}
			},
			changeValue: function(activeItem){
				if(!activeItem[0]){return;}
				var spinner;
				var newValue = $('span.option-value', activeItem).text();
				var oldValue = $.prop(this.input, 'value');
				if(newValue != oldValue){
					
					$(this.input)
						.prop('value', newValue)
						.triggerHandler('updateInput')
					;
					this.changedValue = true;
					if((spinner = $.data(this.input, 'wsspinner')) && spinner.setInput){
						spinner.setInput(newValue);
					}
				}
			},
			markItem: function(index, doValue, items){
				var activeItem;
				var goesUp;
				
				items = items || $('li:not(.hidden-item)', this.shadowList);
				if(!items.length){return;}
				if(index < 0){
					index = items.length - 1;
				} else if(index >= items.length){
					index = 0;
				}
				items.removeClass('active-item');
				this.shadowList.addClass('list-item-active');
				activeItem = items.filter(':eq('+ index +')').addClass('active-item');
				
				if(doValue){
					this.changeValue(activeItem);
					this.scrollIntoView(activeItem);
				}
				this.index = index;
			}
		};
		
		//init datalist update
		initializeDatalist();
	})();
	
});