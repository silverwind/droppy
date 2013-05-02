(function($){
	if(navigator.geolocation){return;}
	var domWrite = function(){
			setTimeout(function(){
				throw('document.write is overwritten by geolocation shim. This method is incompatible with this plugin');
			}, 1);
		},
		id = 0
	;
	var geoOpts = $.webshims.cfg.geolocation || {};
	navigator.geolocation = (function(){
		var pos;
		var api = {
			getCurrentPosition: function(success, error, opts){
				var locationAPIs = 2,
					errorTimer,
					googleTimer,
					calledEnd,
					endCallback = function(){
						if(calledEnd){return;}
						if(pos){
							calledEnd = true;
							success($.extend({timestamp: new Date().getTime()}, pos));
							resetCallback();
							if(window.JSON && window.sessionStorage){
								try{
									sessionStorage.setItem('storedGeolocationData654321', JSON.stringify(pos));
								} catch(e){}
							}
						} else if(error && !locationAPIs) {
							calledEnd = true;
							resetCallback();
							error({ code: 2, message: "POSITION_UNAVAILABLE"});
						}
					},
					googleCallback = function(){
						locationAPIs--;
						getGoogleCoords();
						endCallback();
					},
					resetCallback = function(){
						$(document).unbind('google-loader', resetCallback);
						clearTimeout(googleTimer);
						clearTimeout(errorTimer);
					},
					getGoogleCoords = function(){
						if(pos || !window.google || !google.loader || !google.loader.ClientLocation){return false;}
						var cl = google.loader.ClientLocation;
			            pos = {
							coords: {
								latitude: cl.latitude,
				                longitude: cl.longitude,
				                altitude: null,
				                accuracy: 43000,
				                altitudeAccuracy: null,
				                heading: parseInt('NaN', 10),
				                velocity: null
							},
			                //extension similiar to FF implementation
							address: $.extend({streetNumber: '', street: '', premises: '', county: '', postalCode: ''}, cl.address)
			            };
						return true;
					},
					getInitCoords = function(){
						if(pos){return;}
						getGoogleCoords();
						if(pos || !window.JSON || !window.sessionStorage){return;}
						try{
							pos = sessionStorage.getItem('storedGeolocationData654321');
							pos = (pos) ? JSON.parse(pos) : false;
							if(!pos.coords){pos = false;} 
						} catch(e){
							pos = false;
						}
					}
				;
				
				getInitCoords();
				
				if(!pos){
					if(geoOpts.confirmText && !confirm(geoOpts.confirmText.replace('{location}', location.hostname))){
						if(error){
							error({ code: 1, message: "PERMISSION_DENIED"});
						}
						return;
					}
					$.ajax({
						url: 'http://freegeoip.net/json/',
						dataType: 'jsonp',
						cache: true,
						jsonp: 'callback',
						success: function(data){
							locationAPIs--;
							if(!data){return;}
							pos = pos || {
								coords: {
									latitude: data.latitude,
					                longitude: data.longitude,
					                altitude: null,
					                accuracy: 43000,
					                altitudeAccuracy: null,
					                heading: parseInt('NaN', 10),
					                velocity: null
								},
				                //extension similiar to FF implementation
								address: {
									city: data.city,
									country: data.country_name,
									countryCode: data.country_code,
									county: "",
									postalCode: data.zipcode,
									premises: "",
									region: data.region_name,
									street: "",
									streetNumber: ""
								}
				            };
							endCallback();
						},
						error: function(){
							locationAPIs--;
							endCallback();
						}
					});
					clearTimeout(googleTimer);
					if (!window.google || !window.google.loader) {
						googleTimer = setTimeout(function(){
							//destroys document.write!!!
							if (geoOpts.destroyWrite) {
								document.write = domWrite;
								document.writeln = domWrite;
							}
							$(document).one('google-loader', googleCallback);
							$.webshims.loader.loadScript('http://www.google.com/jsapi', false, 'google-loader');
						}, 800);
					} else {
						locationAPIs--;
					}
				} else {
					setTimeout(endCallback, 1);
					return;
				}
				if(opts && opts.timeout){
					errorTimer = setTimeout(function(){
						resetCallback();
						if(error) {
							error({ code: 3, message: "TIMEOUT"});
						}
					}, opts.timeout);
				} else {
					errorTimer = setTimeout(function(){
						locationAPIs = 0;
						endCallback();
					}, 10000);
				}
			},
			clearWatch: $.noop
		};
		api.watchPosition = function(a, b, c){
			api.getCurrentPosition(a, b, c);
			id++;
			return id;
		};
		return api;
	})();
	
	$.webshims.isReady('geolocation', true);
})(jQuery);

jQuery.webshims.register('details', function($, webshims, window, doc, undefined, options){
	var isInterActiveSummary = function(summary){
		var details = $(summary).parent('details');
		if(details[0] && details.children(':first').get(0) === summary){
			return details;
		}
	};
	
	var bindDetailsSummary = function(summary, details){
		summary = $(summary);
		details = $(details);
		var oldSummary = $.data(details[0], 'summaryElement');
		$.data(summary[0], 'detailsElement', details);
		if(!oldSummary || summary[0] !== oldSummary[0]){
			if(oldSummary){
				if(oldSummary.hasClass('fallback-summary')){
					oldSummary.remove();
				} else {
					oldSummary
						.unbind('.summaryPolyfill')
						.removeData('detailsElement')
						.removeAttr('role')
						.removeAttr('tabindex')
						.removeAttr('aria-expanded')
						.removeClass('summary-button')
						.find('span.details-open-indicator')
						.remove()
					;
				}
			}
			$.data(details[0], 'summaryElement', summary);
			details.prop('open', details.prop('open'));
		}
	};
	var getSummary = function(details){
		var summary = $.data(details, 'summaryElement');
		if(!summary){
			summary = $('> summary:first-child', details);
			if(!summary[0]){
				$(details).prependPolyfill('<summary class="fallback-summary">'+ options.text +'</summary>');
				summary = $.data(details, 'summaryElement');
			} else {
				bindDetailsSummary(summary, details);
			}
		}
		return summary;
	};
	
//	var isOriginalPrevented = function(e){
//		var src = e.originalEvent;
//		if(!src){return e.isDefaultPrevented();}
//		
//		return src.defaultPrevented || src.returnValue === false ||
//			src.getPreventDefault && src.getPreventDefault();
//	};
	
	webshims.createElement('summary', function(){
		var details = isInterActiveSummary(this);
		if(!details || $.data(this, 'detailsElement')){return;}
		var timer;
		var stopNativeClickTest;
		var tabindex = $.attr(this, 'tabIndex') || '0';
		bindDetailsSummary(this, details);
		$(this)
			.on({
				'focus.summaryPolyfill': function(){
					$(this).addClass('summary-has-focus');
				},
				'blur.summaryPolyfill': function(){
					$(this).removeClass('summary-has-focus');
				},
				'mouseenter.summaryPolyfill': function(){
					$(this).addClass('summary-has-hover');
				},
				'mouseleave.summaryPolyfill': function(){
					$(this).removeClass('summary-has-hover');
				},
				'click.summaryPolyfill': function(e){
					var details = isInterActiveSummary(this);
					if(details){
						if(!stopNativeClickTest && e.originalEvent){
							stopNativeClickTest = true;
							e.stopImmediatePropagation();
							e.preventDefault();
							$(this).trigger('click');
							stopNativeClickTest = false;
							return false;
						} else {
							clearTimeout(timer); 
							
							timer = setTimeout(function(){
								if(!e.isDefaultPrevented()){
									details.prop('open', !details.prop('open'));
								}
							}, 0);
						}
					}
				},
				'keydown.summaryPolyfill': function(e){
					if( (e.keyCode == 13 || e.keyCode == 32) && !e.isDefaultPrevented()){
						stopNativeClickTest = true;
						e.preventDefault();
						$(this).trigger('click');
						stopNativeClickTest = false;
					}
				}
			})
			.attr({tabindex: tabindex, role: 'button'})
			.prepend('<span class="details-open-indicator" />')
		;
		webshims.moveToFirstEvent(this, 'click');
	});
	
	var initDetails;
	webshims.defineNodeNamesBooleanProperty('details', 'open', function(val){
		var summary = $($.data(this, 'summaryElement'));
		if(!summary){return;}
		var action = (val) ? 'removeClass' : 'addClass';
		var details = $(this);
		if (!initDetails && options.animate){
			details.stop().css({width: '', height: ''});
			var start = {
				width: details.width(),
				height: details.height()
			};
		}
		summary.attr('aria-expanded', ''+val);
		details[action]('closed-details-summary').children().not(summary[0])[action]('closed-details-child');
		if(!initDetails && options.animate){
			var end = {
				width: details.width(),
				height: details.height()
			};
			details.css(start).animate(end, {
				complete: function(){
					$(this).css({width: '', height: ''});
				}
			});
		}
		
	});
	webshims.createElement('details', function(){
		initDetails = true;
		var summary = getSummary(this);
		$.prop(this, 'open', $.prop(this, 'open'));
		initDetails = false;
	});
});

jQuery.webshims.register('mediaelement-jaris', function($, webshims, window, document, undefined, options){
	"use strict";
	
	var mediaelement = webshims.mediaelement;
	var swfmini = window.swfmini;
	var hasNative = Modernizr.audio && Modernizr.video;
	var hasFlash = swfmini.hasFlashPlayerVersion('9.0.115');
	var loadedSwf = 0;
	var getProps = {
		paused: true,
		ended: false,
		currentSrc: '',
		duration: window.NaN,
		readyState: 0,
		networkState: 0,
		videoHeight: 0,
		videoWidth: 0,
		error: null,
		buffered: {
			start: function(index){
				if(index){
					webshims.error('buffered index size error');
					return;
				}
				return 0;
			},
			end: function(index){
				if(index){
					webshims.error('buffered index size error');
					return;
				}
				return 0;
			},
			length: 0
		}
	};
	var getPropKeys = Object.keys(getProps);
	
	var getSetProps = {
		currentTime: 0,
		volume: 1,
		muted: false
	};
	var getSetPropKeys = Object.keys(getSetProps);
	
	var playerStateObj = $.extend({
		isActive: 'html5',
		activating: 'html5',	
		wasSwfReady: false,
		_bufferedEnd: 0,
		_bufferedStart: 0,
		currentTime: 0,
		_ppFlag: undefined,
		_calledMeta: false,
		lastDuration: 0
	}, getProps, getSetProps);
	
	var idRep = /^jarisplayer-/;
	var getSwfDataFromID = function(id){
		
		var elem = document.getElementById(id.replace(idRep, ''));
		if(!elem){return;}
		var data = webshims.data(elem, 'mediaelement');
		return data.isActive == 'third' ? data : null;
	};
	
	
	var getSwfDataFromElem = function(elem){
		try {
			(elem.nodeName);
		} catch(er){
			return null;
		}
		var data = webshims.data(elem, 'mediaelement');
		return (data && data.isActive== 'third') ? data : null;
	};
	
	var trigger = function(elem, evt){
		evt = $.Event(evt);
		evt.preventDefault();
		$.event.trigger(evt, undefined, elem);
	};
	
	var playerSwfPath = options.playerPath || webshims.cfg.basePath + "swf/" + (options.playerName || 'JarisFLVPlayer.swf');
	
	webshims.extendUNDEFProp(options.params, {
		allowscriptaccess: 'always',
		allowfullscreen: 'true',
		wmode: 'transparent',
		allowNetworking: 'all'
	});
	webshims.extendUNDEFProp(options.vars, {
		controltype: '1',
		jsapi: '1'
	});
	webshims.extendUNDEFProp(options.attrs, {
		bgcolor: '#000000'
	});
	
	var setReadyState = function(readyState, data){
		if(readyState < 3){
			clearTimeout(data._canplaythroughTimer);
		}
		if(readyState >= 3 && data.readyState < 3){
			data.readyState = readyState;
			trigger(data._elem, 'canplay');
			if(!data.paused){
				trigger(data._elem, 'playing');
			}
			clearTimeout(data._canplaythroughTimer);
			data._canplaythroughTimer = setTimeout(function(){
				setReadyState(4, data);
			}, 4000);
		}
		if(readyState >= 4 && data.readyState < 4){
			data.readyState = readyState;
			trigger(data._elem, 'canplaythrough');
		}
		data.readyState = readyState;
	};
	
	$.extend($.event.customEvent, {
		updatemediaelementdimensions: true,
		flashblocker: true,
		swfstageresize: true,
		mediaelementapichange: true
	});
	
	mediaelement.jarisEvent = {};
	var localConnectionTimer;
	var onEvent = {
		onPlayPause: function(jaris, data, override){
			var playing, type;
			if(override == null){
				try {
					playing = data.api.api_get("isPlaying");
				} catch(e){}
			} else {
				playing = override;
			}
			if(playing == data.paused){
				
				data.paused = !playing;
				type = data.paused ? 'pause' : 'play';
				data._ppFlag = true;
				trigger(data._elem, type);
				if(data.readyState < 3){
					setReadyState(3, data);
				}
				if(!data.paused){
					trigger(data._elem, 'playing');
				}
			}
		},
		onNotBuffering: function(jaris, data){
			setReadyState(3, data);
		},
		onDataInitialized: function(jaris, data){
			
			var oldDur = data.duration;
			var durDelta;
			data.duration = jaris.duration;
			if(oldDur == data.duration || isNaN(data.duration)){return;}
			
			if(data._calledMeta && ((durDelta = Math.abs(data.lastDuration - data.duration)) < 2)){return;}
			
			
			
			data.videoHeight = jaris.height;
			data.videoWidth = jaris.width;
			
			if(!data.networkState){
				data.networkState = 2;
			}
			if(data.readyState < 1){
				setReadyState(1, data);
			}
			clearTimeout(data._durationChangeTimer);
			if(data._calledMeta && data.duration){
				data._durationChangeTimer = setTimeout(function(){
					data.lastDuration = data.duration;
					trigger(data._elem, 'durationchange');
				}, durDelta > 50 ? 0 : durDelta > 9 ? 9 : 99);
			} else {
				data.lastDuration = data.duration;
				if(data.duration){
					trigger(data._elem, 'durationchange');
				}
				if(!data._calledMeta){
					trigger(data._elem, 'loadedmetadata');
				}
			}
			data._calledMeta = true;
		},
		onBuffering: function(jaris, data){
			if(data.ended){
				data.ended = false;
			}
			setReadyState(1, data);
			trigger(data._elem, 'waiting');
		},
		onTimeUpdate: function(jaris, data){
			if(data.ended){
				data.ended = false;
			}
			if(data.readyState < 3){
				setReadyState(3, data);
				trigger(data._elem, 'playing');
			}
			
			trigger(data._elem, 'timeupdate');
		},
		onProgress: function(jaris, data){
			if(data.ended){
				data.ended = false;
			}
			if(!data.duration || isNaN(data.duration)){
				return;
			}
			var percentage = jaris.loaded / jaris.total;
			if(percentage > 0.02 && percentage < 0.2){
				setReadyState(3, data);
			} else if(percentage > 0.2){
				if(percentage > 0.99){
					data.networkState = 1;
				}
				setReadyState(4, data);
			}
			if(data._bufferedEnd && (data._bufferedEnd > percentage)){
				data._bufferedStart = data.currentTime || 0;
			}
			
			data._bufferedEnd = percentage;
			data.buffered.length = 1;
			
			$.event.trigger('progress', undefined, data._elem, true);
		},
		onPlaybackFinished: function(jaris, data){
			if(data.readyState < 4){
				setReadyState(4, data);
			}
			data.ended = true;
			trigger(data._elem, 'ended');
		},
		onVolumeChange: function(jaris, data){
			if(data.volume != jaris.volume || data.muted != jaris.mute){
				data.volume = jaris.volume;
				data.muted = jaris.mute;
				trigger(data._elem, 'volumechange');
			}
		},
		ready: (function(){
			var testAPI = function(data){
				var passed = true;
				
				try {
					data.api.api_get('volume');
				} catch(er){
					passed = false;
				}
				return passed;
			};
			
			return function(jaris, data){
				var i = 0;
				var doneFn = function(){
					if(i > 9){
						data.tryedReframeing = 0;
						return;
					}
					i++;
					
					data.tryedReframeing++;
					if(testAPI(data)){
						data.wasSwfReady = true;
						data.tryedReframeing = 0;
						startAutoPlay(data);
						workActionQueue(data);
					} else if(data.tryedReframeing < 6) {
						if(data.tryedReframeing < 3){
							data.reframeTimer = setTimeout(doneFn, 9);
							data.shadowElem.css({overflow: 'visible'});
							setTimeout(function(){
								data.shadowElem.css({overflow: 'hidden'});
							}, 1);
						} else {
							data.shadowElem.css({overflow: 'hidden'});
							$(data._elem).mediaLoad();
						}
					} else {
						clearTimeout(data.reframeTimer);
						webshims.error("reframing error");
					}
				};
				if(!data || !data.api){return;}
				if(!data.tryedReframeing){
					data.tryedReframeing = 0;
				}
				clearTimeout(localConnectionTimer);
				clearTimeout(data.reframeTimer);
				data.shadowElem.removeClass('flashblocker-assumed');
				
				if(!i){
					doneFn();
				} else {
					data.reframeTimer = setTimeout(doneFn, 9);
				}
				
			};
		})()
	};
	
	onEvent.onMute = onEvent.onVolumeChange;
	
	
	var workActionQueue = function(data){
		var actionLen = data.actionQueue.length;
		var i = 0;
		var operation;
		
		if(actionLen && data.isActive == 'third'){
			while(data.actionQueue.length && actionLen > i){
				i++;
				operation = data.actionQueue.shift();
				try{
					data.api[operation.fn].apply(data.api, operation.args);
				} catch(er){
					webshims.warn(er);
				}
			}
		}
		if(data.actionQueue.length){
			data.actionQueue = [];
		}
	};
	var startAutoPlay = function(data){
		if(!data){return;}
		if( (data._ppFlag === undefined && ($.prop(data._elem, 'autoplay')) || !data.paused)){
			setTimeout(function(){
				if(data.isActive == 'third' && (data._ppFlag === undefined || !data.paused)){
					
					try {
						$(data._elem).play();
						data._ppFlag = true;
					} catch(er){}
				}
			}, 1);
		}
		
		if(data.muted){
			$.prop(data._elem, 'muted', true);
		}
		if(data.volume != 1){
			$.prop(data._elem, 'volume', data.volume);
		}
	};
	
	
	var addMediaToStopEvents = $.noop;
	if(hasNative){
		var stopEvents = {
			play: 1,
			playing: 1
		};
		var hideEvtArray = ['play', 'pause', 'playing', 'canplay', 'progress', 'waiting', 'ended', 'loadedmetadata', 'durationchange', 'emptied'];
		var hidevents = hideEvtArray.map(function(evt){
			return evt +'.webshimspolyfill';
		}).join(' ');
		
		var hidePlayerEvents = function(event){
			var data = webshims.data(event.target, 'mediaelement');
			if(!data){return;}
			var isNativeHTML5 = ( event.originalEvent && event.originalEvent.type === event.type );
			if( isNativeHTML5 == (data.activating == 'third') ){
				event.stopImmediatePropagation();
				if(stopEvents[event.type] && data.isActive != data.activating){
					$(event.target).pause();
				}
			}
		};
		
		addMediaToStopEvents = function(elem){
			$(elem)
				.off(hidevents)
				.on(hidevents, hidePlayerEvents)
			;
			hideEvtArray.forEach(function(evt){
				webshims.moveToFirstEvent(elem, evt);
			});
		};
		addMediaToStopEvents(document);
	}
	
	
	mediaelement.setActive = function(elem, type, data){
		if(!data){
			data = webshims.data(elem, 'mediaelement');
		}
		if(!data || data.isActive == type){return;}
		if(type != 'html5' && type != 'third'){
			webshims.warn('wrong type for mediaelement activating: '+ type);
		}
		var shadowData = webshims.data(elem, 'shadowData');
		data.activating = type;
		$(elem).pause();
		data.isActive = type;
		if(type == 'third'){
			shadowData.shadowElement = shadowData.shadowFocusElement = data.shadowElem[0];
			$(elem).addClass('swf-api-active nonnative-api-active').hide().getShadowElement().show();
		} else {
			$(elem).removeClass('swf-api-active nonnative-api-active').show().getShadowElement().hide();
			shadowData.shadowElement = shadowData.shadowFocusElement = false;
		}
		$(elem).trigger('mediaelementapichange');
	};
	
	
	
	var resetSwfProps = (function(){
		var resetProtoProps = ['_calledMeta', 'lastDuration', '_bufferedEnd', '_bufferedStart', '_ppFlag', 'currentSrc', 'currentTime', 'duration', 'ended', 'networkState', 'paused', 'videoHeight', 'videoWidth'];
		var len = resetProtoProps.length;
		return function(data){
			
			if(!data){return;}
			var lenI = len;
			var networkState = data.networkState;
			setReadyState(0, data);
			clearTimeout(data._durationChangeTimer);
			while(--lenI > -1){
				delete data[resetProtoProps[lenI]];
			}
			data.actionQueue = [];
			data.buffered.length = 0;
			if(networkState){
				trigger(data._elem, 'emptied');
			}
		};
	})();
	
	var setElementDimension = function(data, hasControls){
		var elem = data._elem;
		var box = data.shadowElem;
		$(elem)[hasControls ? 'addClass' : 'removeClass']('webshims-controls');
		if(data._elemNodeName == 'audio' && !hasControls){
			box.css({width: 0, height: 0});
		} else {
			box.css({
				width: elem.style.width || $(elem).width(),
				height: elem.style.height || $(elem).height()
			});
		}
	};
	
	var bufferSrc = (function(){
		var preloads = {
			'': 1,
			'auto': 1
		};
		return function(elem){
			var preload = $.attr(elem, 'preload');
			if(preload == null || preload == 'none' || $.prop(elem, 'autoplay')){
				return false;
			}
			preload =  $.prop(elem, 'preload');
			return !!(preloads[preload] || (preload == 'metadata' && $(elem).is('.preload-in-doubt, video:not([poster])')));
		};
	})();
	
	var regs = {
		A: /&amp;/g,
		a: /&/g,
		e: /\=/g,
		q: /\?/g
	},
	replaceVar = function(val){
		return (val.replace) ? val.replace(regs.A, '%26').replace(regs.a, '%26').replace(regs.e, '%3D').replace(regs.q, '%3F') : val;
	};
	
	mediaelement.createSWF = function( elem, canPlaySrc, data ){
		if(!hasFlash){
			setTimeout(function(){
				$(elem).mediaLoad(); //<- this should produce a mediaerror
			}, 1);
			return;
		}
		
		if(loadedSwf < 1){
			loadedSwf = 1;
		} else {
			loadedSwf++;
		}
		if(!data){
			data = webshims.data(elem, 'mediaelement');
		}
		
		if($.attr(elem, 'height') || $.attr(elem, 'width')){
			webshims.warn("width or height content attributes used. Webshims only uses CSS (computed styles or inline styles) to detect size of a video/audio");
		}
		
		var isRtmp = canPlaySrc.type == 'audio/rtmp' || canPlaySrc.type == 'video/rtmp';
		var vars = $.extend({}, options.vars, {
				poster: replaceVar($.attr(elem, 'poster') && $.prop(elem, 'poster') || ''),
				source: replaceVar(canPlaySrc.streamId || canPlaySrc.srcProp),
				server: replaceVar(canPlaySrc.server || '')
		});
		var elemVars = $(elem).data('vars') || {};
		
		
		
		var hasControls = $.prop(elem, 'controls');
		var elemId = 'jarisplayer-'+ webshims.getID(elem);
		
		var params = $.extend(
			{},
			options.params,
			$(elem).data('params')
		);
		var elemNodeName = elem.nodeName.toLowerCase();
		var attrs = $.extend(
			{},
			options.attrs,
			{
				name: elemId,
				id: elemId
			},
			$(elem).data('attrs')
		);
		var setDimension = function(){
			setElementDimension(data, $.prop(elem, 'controls'));
		};
		
		var box;
		
		if(data && data.swfCreated){
			mediaelement.setActive(elem, 'third', data);
			
			data.currentSrc = canPlaySrc.srcProp;
			
			data.shadowElem.html('<div id="'+ elemId +'">');
			
			data.api = false;
			data.actionQueue = [];
			box = data.shadowElem;
			resetSwfProps(data);
		} else {
			box = $('<div class="polyfill-'+ (elemNodeName) +' polyfill-mediaelement" id="wrapper-'+ elemId +'"><div id="'+ elemId +'"></div>')
				.css({
					position: 'relative',
					overflow: 'hidden'
				})
			;
			data = webshims.data(elem, 'mediaelement', webshims.objectCreate(playerStateObj, {
				actionQueue: {
					value: []
				},
				shadowElem: {
					value: box
				},
				_elemNodeName: {
					value: elemNodeName
				},
				_elem: {
					value: elem
				},
				currentSrc: {
					value: canPlaySrc.srcProp
				},
				swfCreated: {
					value: true
				},
				id: {
					value: elemId.replace(/-/g, '')
				},
				buffered: {
					value: {
						start: function(index){
							if(index >= data.buffered.length){
								webshims.error('buffered index size error');
								return;
							}
							return 0;
						},
						end: function(index){
							if(index >= data.buffered.length){
								webshims.error('buffered index size error');
								return;
							}
							return ( (data.duration - data._bufferedStart) * data._bufferedEnd) + data._bufferedStart;
						},
						length: 0
					}
				}
			}));
			setElementDimension(data, hasControls);
		
			box.insertBefore(elem);
			
			if(hasNative){
				$.extend(data, {volume: $.prop(elem, 'volume'), muted: $.prop(elem, 'muted'), paused: $.prop(elem, 'paused')});
			}
			
			webshims.addShadowDom(elem, box);
			addMediaToStopEvents(elem);
			mediaelement.setActive(elem, 'third', data);
			$(elem)
				.on({'updatemediaelementdimensions': setDimension})
				.onWSOff('updateshadowdom', setDimension)
			;
		}
		
		if(!mediaelement.jarisEvent[data.id]){
			mediaelement.jarisEvent[data.id] = function(jaris){
				if(jaris.type == 'ready'){
					var onReady = function(){
						if(data.api){
							if(bufferSrc(elem)){
								data.api.api_preload();
							}
							onEvent.ready(jaris, data);
						}
					};
					if(data.api){
						onReady();
					} else {
						setTimeout(onReady, 9);
					}
				} else {
					data.currentTime = jaris.position;
					
					if(data.api){
						if(!data._calledMeta && isNaN(jaris.duration) && data.duration != jaris.duration && isNaN(data.duration)){
							onEvent.onDataInitialized(jaris, data);
						}
						
						if(!data._ppFlag && jaris.type != 'onPlayPause'){
							onEvent.onPlayPause(jaris, data);
						}
						
						if(onEvent[jaris.type]){
							onEvent[jaris.type](jaris, data);
						}
					}
					data.duration = jaris.duration;
				}
				
			};
		}
		
		$.extend(vars, 
			{
				id: elemId,
				evtId: data.id,
				controls: ''+hasControls,
				autostart: 'false',
				nodename: elemNodeName
			},
			elemVars
		);
		
		if(isRtmp){
			vars.streamtype = 'rtmp';
		} else if(canPlaySrc.type == 'audio/mpeg' || canPlaySrc.type == 'audio/mp3'){
			vars.type = 'audio';
			vars.streamtype = 'file';
		} else if(canPlaySrc.type == 'video/youtube'){
			vars.streamtype = 'youtube';
		}
		options.changeSWF(vars, elem, canPlaySrc, data, 'embed');
		clearTimeout(data.flashBlock);
		
		swfmini.embedSWF(playerSwfPath, elemId, "100%", "100%", "9.0.115", false, vars, params, attrs, function(swfData){
			
			if(swfData.success){
				
				data.api = swfData.ref;
				
				if(!hasControls){
					$(swfData.ref).attr('tabindex', '-1').css('outline', 'none');
				}
				
				data.flashBlock = setTimeout(function(){
					if((!swfData.ref.parentNode && box[0].parentNode) || swfData.ref.style.display == "none"){
						box.addClass('flashblocker-assumed');
						$(elem).trigger('flashblocker');
						webshims.warn("flashblocker assumed");
					}
					$(swfData.ref).css({'minHeight': '2px', 'minWidth': '2px', display: 'block'});
				}, 9);
				
				if(!localConnectionTimer){
					clearTimeout(localConnectionTimer);
					localConnectionTimer = setTimeout(function(){
						var flash = $(swfData.ref);
						if(flash[0].offsetWidth > 1 && flash[0].offsetHeight > 1 && location.protocol.indexOf('file:') === 0){
							webshims.error("Add your local development-directory to the local-trusted security sandbox:  http://www.macromedia.com/support/documentation/en/flashplayer/help/settings_manager04.html");
						} else if(flash[0].offsetWidth < 2 || flash[0].offsetHeight < 2) {
							webshims.warn("JS-SWF connection can't be established on hidden or unconnected flash objects");
						}
						flash = null;
					}, 8000);
				}
			}
		});
		
	};
	
	
	var queueSwfMethod = function(elem, fn, args, data){
		data = data || getSwfDataFromElem(elem);
		
		if(data){
			if(data.api && data.api[fn]){
				data.api[fn].apply(data.api, args || []);
			} else {
				//todo add to queue
				data.actionQueue.push({fn: fn, args: args});
				
				if(data.actionQueue.length > 10){
					setTimeout(function(){
						if(data.actionQueue.length > 5){
							data.actionQueue.shift();
						}
					}, 99);
				}
			}
			return data;
		}
		return false;
	};
	
	['audio', 'video'].forEach(function(nodeName){
		var descs = {};
		var mediaSup;
		var createGetProp = function(key){
			if(nodeName == 'audio' && (key == 'videoHeight' || key == 'videoWidth')){return;}
			
			descs[key] = {
				get: function(){
					var data = getSwfDataFromElem(this);
					if(data){
						return data[key];
					} else if(hasNative && mediaSup[key].prop._supget) {
						return mediaSup[key].prop._supget.apply(this);
					} else {
						return playerStateObj[key];
					}
				},
				writeable: false
			};
		};
		var createGetSetProp = function(key, setFn){
			createGetProp(key);
			delete descs[key].writeable;
			descs[key].set = setFn;
		};
		
		createGetSetProp('volume', function(v){
			var data = getSwfDataFromElem(this);
			if(data){
				v *= 1;
				if(!isNaN(v)){
					
					if(v < 0 || v > 1){
						webshims.error('volume greater or less than allowed '+ (v / 100));
					}
					
					queueSwfMethod(this, 'api_volume', [v], data);
					
					
					if(data.volume != v){
						data.volume = v;
						trigger(data._elem, 'volumechange');
					}
					data = null;
				} 
			} else if(mediaSup.volume.prop._supset) {
				return mediaSup.volume.prop._supset.apply(this, arguments);
			}
		});
		
		createGetSetProp('muted', function(m){
			var data = getSwfDataFromElem(this);
			if(data){
				m = !!m;
				queueSwfMethod(this, 'api_muted', [m], data);
				if(data.muted != m){
					data.muted = m;
					trigger(data._elem, 'volumechange');
				}
				data = null;
			} else if(mediaSup.muted.prop._supset) {
				return mediaSup.muted.prop._supset.apply(this, arguments);
			}
		});
		
		
		createGetSetProp('currentTime', function(t){
			var data = getSwfDataFromElem(this);
			if(data){
				t *= 1;
				if (!isNaN(t)) {
					queueSwfMethod(this, 'api_seek', [t], data);
				}
				 
			} else if(mediaSup.currentTime.prop._supset) {
				return mediaSup.currentTime.prop._supset.apply(this, arguments);
			}
		});
		
		['play', 'pause'].forEach(function(fn){
			descs[fn] = {
				value: function(){
					var data = getSwfDataFromElem(this);
					if(data){
						if(data.stopPlayPause){
							clearTimeout(data.stopPlayPause);
						}
						queueSwfMethod(this, fn == 'play' ? 'api_play' : 'api_pause', [], data);
						
						data._ppFlag = true;
						if(data.paused != (fn != 'play')){
							data.paused = fn != 'play';
							trigger(data._elem, fn);
						}
					} else if(mediaSup[fn].prop._supvalue) {
						return mediaSup[fn].prop._supvalue.apply(this, arguments);
					}
				}
			};
		});
		
		getPropKeys.forEach(createGetProp);
		
		webshims.onNodeNamesPropertyModify(nodeName, 'controls', function(val, boolProp){
			var data = getSwfDataFromElem(this);
			$(this)[boolProp ? 'addClass' : 'removeClass']('webshims-controls');
			
			if(data){
				if(nodeName == 'audio'){
					setElementDimension(data, boolProp);
				}
				queueSwfMethod(this, 'api_controls', [boolProp], data);
			}
		});
		
		webshims.onNodeNamesPropertyModify(nodeName, 'preload', function(val){
			var data = getSwfDataFromElem(this);
			
			
			if(data && bufferSrc(this)){
				queueSwfMethod(this, 'api_preload', [], data);
			}
		});
		
		mediaSup = webshims.defineNodeNameProperties(nodeName, descs, 'prop');
	});
	
	if(hasFlash && $.cleanData){
		var oldClean = $.cleanData;
		var flashNames = {
			object: 1,
			OBJECT: 1
		};
		
		$.cleanData = function(elems){
			var i, len, prop;
			if(elems && (len = elems.length) && loadedSwf){
				
				for(i = 0; i < len; i++){
					if(flashNames[elems[i].nodeName] && 'api_pause' in elems[i]){
						loadedSwf--;
						try {
							elems[i].api_pause();
						} catch(er){}
					}
				}
				
			}
			return oldClean.apply(this, arguments);
		};
	}

	if(!hasNative){
		
		['poster', 'src'].forEach(function(prop){
			webshims.defineNodeNamesProperty(prop == 'src' ? ['audio', 'video', 'source'] : ['video'], prop, {
				//attr: {},
				reflect: true,
				propType: 'src'
			});
		});
		
		webshims.defineNodeNamesProperty(['audio', 'video'], 'preload', {
			reflect: true,
			propType: 'enumarated',
			defaultValue: '',
			limitedTo: ['', 'auto', 'metadata', 'none']
		});
		
		
		['autoplay', 'controls'].forEach(function(name){
			webshims.defineNodeNamesBooleanProperty(['audio', 'video'], name);
		});
			
		webshims.defineNodeNamesProperties(['audio', 'video'], {
			HAVE_CURRENT_DATA: {
				value: 2
			},
			HAVE_ENOUGH_DATA: {
				value: 4
			},
			HAVE_FUTURE_DATA: {
				value: 3
			},
			HAVE_METADATA: {
				value: 1
			},
			HAVE_NOTHING: {
				value: 0
			},
			NETWORK_EMPTY: {
				value: 0
			},
			NETWORK_IDLE: {
				value: 1
			},
			NETWORK_LOADING: {
				value: 2
			},
			NETWORK_NO_SOURCE: {
				value: 3
			}
					
		}, 'prop');
	}
	
	
});
jQuery.webshims.register('track', function($, webshims, window, document, undefined){
	"use strict";
	var mediaelement = webshims.mediaelement;
	var id = new Date().getTime();
	var ADDBACK = $.fn.addBack ? 'addBack' : 'andSelf';
	//descriptions are not really shown, but they are inserted into the dom
	var showTracks = {subtitles: 1, captions: 1, descriptions: 1};
	var notImplemented = function(){
		webshims.error('not implemented yet');
	};
	var dummyTrack = $('<track />');
	var supportTrackMod = Modernizr.ES5 && Modernizr.objectAccessor;
	var createEventTarget = function(obj){
		var eventList = {};
		obj.addEventListener = function(name, fn){
			if(eventList[name]){
				webshims.error('always use $.on to the shimed event: '+ name +' already bound fn was: '+ eventList[name] +' your fn was: '+ fn);
			}
			eventList[name] = fn;
			
		};
		obj.removeEventListener = function(name, fn){
			if(eventList[name] && eventList[name] != fn){
				webshims.error('always use $.on/$.off to the shimed event: '+ name +' already bound fn was: '+ eventList[name] +' your fn was: '+ fn);
			}
			if(eventList[name]){
				delete eventList[name];
			}
		};
		return obj;
	};
	
	var cueListProto = {
		getCueById: function(id){
			var cue = null;
			for(var i = 0, len = this.length; i < len; i++){
				if(this[i].id === id){
					cue = this[i];
					break;
				}
			}
			return cue;
		}
	};
	var numericModes = {
		0: 'disabled',
		1: 'hidden',
		2: 'showing'
	};
	
	var textTrackProto = {
		shimActiveCues: null,
		_shimActiveCues: null,
		activeCues: null,
		cues: null,
		kind: 'subtitles',
		label: '',
		language: '',
		mode: 'disabled',
		readyState: 0,
		oncuechange: null,
		toString: function() {
			return "[object TextTrack]";
		},
		addCue: function(cue){
			if(!this.cues){
				this.cues = mediaelement.createCueList();
			} else {
				var lastCue = this.cues[this.cues.length-1];
				if(lastCue && lastCue.startTime > cue.startTime){
					webshims.error("cue startTime higher than previous cue's startTime");
				}
			}
			if(cue.track && cue.track.removeCue){
				cue.track.removeCue(cue);
			}
			cue.track = this;
			this.cues.push(cue);
		},
		//ToDo: make it more dynamic
		removeCue: function(cue){
			var cues = this.cues || [];
			var i = 0;
			var len = cues.length;
			if(cue.track != this){
				webshims.error("cue not part of track");
				return;
			}
			for(; i < len; i++){
				if(cues[i] === cue){
					cues.splice(i, 1);
					cue.track = null;
					break;
				}
			}
			if(cue.track){
				webshims.error("cue not part of track");
				return;
			}
		},
		DISABLED: 'disabled',
		OFF: 'disabled',
		HIDDEN: 'hidden',
		SHOWING: 'showing',
		ERROR: 3,
		LOADED: 2,
		LOADING: 1,
		NONE: 0
	};
	var copyProps = ['kind', 'label', 'srclang'];
	var copyName = {srclang: 'language'};
	
	var owns = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
	
	var updateMediaTrackList = function(baseData, trackList){
		var removed = [];
		var added = [];
		var newTracks = [];
		var i, len;
		if(!baseData){
			baseData =  webshims.data(this, 'mediaelementBase') || webshims.data(this, 'mediaelementBase', {});
		}
		
		if(!trackList){
			baseData.blockTrackListUpdate = true;
			trackList = $.prop(this, 'textTracks');
			baseData.blockTrackListUpdate = false;
		}
		
		clearTimeout(baseData.updateTrackListTimer);
		
		$('track', this).each(function(){
			var track = $.prop(this, 'track');
			newTracks.push(track);
			if(trackList.indexOf(track) == -1){
				added.push(track);
			}
		});
		
		if(baseData.scriptedTextTracks){
			for(i = 0, len = baseData.scriptedTextTracks.length; i < len; i++){
				newTracks.push(baseData.scriptedTextTracks[i]);
				if(trackList.indexOf(baseData.scriptedTextTracks[i]) == -1){
					added.push(baseData.scriptedTextTracks[i]);
				}
			}
		}
		
		for(i = 0, len = trackList.length; i < len; i++){
			if(newTracks.indexOf(trackList[i]) == -1){
				removed.push(trackList[i]);
			}
		}
		
		if(removed.length || added.length){
			trackList.splice(0);
			
			for(i = 0, len = newTracks.length; i < len; i++){
				trackList.push(newTracks[i]);
			}
			for(i = 0, len = removed.length; i < len; i++){
				$([trackList]).triggerHandler($.Event({type: 'removetrack', track: removed[i]}));
			}
			for(i = 0, len = added.length; i < len; i++){
				$([trackList]).triggerHandler($.Event({type: 'addtrack', track: added[i]}));
			}
			if(baseData.scriptedTextTracks || removed.length){
				$(this).triggerHandler('updatetrackdisplay');
			}
		}
	};
	
	var refreshTrack = function(track, trackData){
		if(!trackData){
			trackData = webshims.data(track, 'trackData');
		}
		if(trackData && !trackData.isTriggering){
			trackData.isTriggering = true;
			setTimeout(function(){
				if(!(trackData.track || {}).readyState){
					$(track).triggerHandler('checktrackmode');
				} else {
					$(track).closest('audio, video').triggerHandler('updatetrackdisplay');
				}
				trackData.isTriggering = false;
			}, 1);
		}
	};
	
	var emptyDiv = $('<div />')[0];
	window.TextTrackCue = function(startTime, endTime, text){
		if(arguments.length != 3){
			webshims.error("wrong arguments.length for TextTrackCue.constructor");
		}
		
		this.startTime = startTime;
		this.endTime = endTime;
		this.text = text;
		
		this.id = "";
		this.pauseOnExit = false;
		
		createEventTarget(this);
	};
	
	window.TextTrackCue.prototype = {
		
		onenter: null,
		onexit: null,
		pauseOnExit: false,
		getCueAsHTML: function(){
			var lastText = "";
			var parsedText = "";
			var fragment = document.createDocumentFragment();
			var fn;
			if(!owns(this, 'getCueAsHTML')){
				fn = this.getCueAsHTML = function(){
					var i, len;
					if(lastText != this.text){
						lastText = this.text;
						parsedText = mediaelement.parseCueTextToHTML(lastText);
						emptyDiv.innerHTML = parsedText;
						
						for(i = 0, len = emptyDiv.childNodes.length; i < len; i++){
							fragment.appendChild(emptyDiv.childNodes[i].cloneNode(true));
						}
					}
					return fragment.cloneNode(true);
				};
				
			}
			return fn ? fn.apply(this, arguments) : fragment.cloneNode(true);
		},
		track: null,
		
		
		id: ''
		//todo-->
//			,
//			snapToLines: true,
//			line: 'auto',
//			size: 100,
//			position: 50,
//			vertical: '',
//			align: 'middle'
	};
	
	
	
	
	
	mediaelement.createCueList = function(){
		return $.extend([], cueListProto);
	};
	
	mediaelement.parseCueTextToHTML = (function(){
		var tagSplits = /(<\/?[^>]+>)/ig;
		var allowedTags = /^(?:c|v|ruby|rt|b|i|u)/;
		var regEnd = /\<\s*\//;
		var addToTemplate = function(localName, attribute, tag, html){
			var ret;
			if(regEnd.test(html)){
				ret = '</'+ localName +'>';
			} else {
				tag.splice(0, 1);
				ret =  '<'+ localName +' '+ attribute +'="'+ (tag.join(' ').replace(/\"/g, '&#34;')) +'">';
			}
			return ret;
		};
		var replacer = function(html){
			var tag = html.replace(/[<\/>]+/ig,"").split(/[\s\.]+/);
			if(tag[0]){
				tag[0] = tag[0].toLowerCase();
				if(allowedTags.test(tag[0])){
					if(tag[0] == 'c'){
						html = addToTemplate('span', 'class', tag, html);
					} else if(tag[0] == 'v'){
						html = addToTemplate('q', 'title', tag, html);
					}
				} else {
					html = "";
				}
			}
			return html;
		};
		
		return function(cueText){
			return cueText.replace(tagSplits, replacer);
		};
	})();
	
	mediaelement.loadTextTrack = function(mediaelem, track, trackData, _default){
		var loadEvents = 'play playing timeupdate updatetrackdisplay';
		var obj = trackData.track;
		var load = function(){
			var src = $.prop(track, 'src');
			var error;
			var ajax;
			if(obj.mode != 'disabled' && src && $.attr(track, 'src')){
				$(mediaelem).unbind(loadEvents, load);
				$(track).unbind('checktrackmode', load);
				if(!obj.readyState){
					error = function(){
						obj.readyState = 3;
						obj.cues = null;
						obj.activeCues = obj.shimActiveCues = obj._shimActiveCues = null;
						$(track).triggerHandler('error');
					};
					obj.readyState = 1;
					try {
						obj.cues = mediaelement.createCueList();
						obj.activeCues = obj.shimActiveCues = obj._shimActiveCues = mediaelement.createCueList();
						ajax = $.ajax({
							dataType: 'text',
							url: src,
							success: function(text){
								if(ajax.getResponseHeader('content-type') != 'text/vtt'){
									webshims.error('set the mime-type of your WebVTT files to text/vtt. see: http://dev.w3.org/html5/webvtt/#text/vtt');
								}
								mediaelement.parseCaptions(text, obj, function(cues){
									if(cues && 'length' in cues){
										obj.readyState = 2;
										$(track).triggerHandler('load');
										$(mediaelem).triggerHandler('updatetrackdisplay');
									} else {
										error();
									}
								});
								
							},
							error: error
						});
					} catch(er){
						error();
						webshims.warn(er);
					}
				}
			}
		};
		obj.readyState = 0;
		obj.shimActiveCues = null;
		obj._shimActiveCues = null;
		obj.activeCues = null;
		obj.cues = null;
		$(mediaelem).unbind(loadEvents, load);
		$(track).unbind('checktrackmode', load);
		$(mediaelem).on(loadEvents, load);
		$(track).on('checktrackmode', load);
		if(_default){
			obj.mode = showTracks[obj.kind] ? 'showing' : 'hidden';
			load();
		}
	};
	
	mediaelement.createTextTrack = function(mediaelem, track){
		var obj, trackData;
		if(track.nodeName){
			trackData = webshims.data(track, 'trackData');
			
			if(trackData){
				refreshTrack(track, trackData);
				obj = trackData.track;
			}
		}
		
		if(!obj){
			obj = createEventTarget(webshims.objectCreate(textTrackProto));
			
			if(!supportTrackMod){
				copyProps.forEach(function(copyProp){
					var prop = $.prop(track, copyProp);
					if(prop){
						obj[copyName[copyProp] || copyProp] = prop;
					}
				});
			}
			
			
			if(track.nodeName){
				
				if(supportTrackMod){
					copyProps.forEach(function(copyProp){
						webshims.defineProperty(obj, copyName[copyProp] || copyProp, {
							get: function(){
								return $.prop(track, copyProp);
							}
						});
					});
				}
				
				trackData = webshims.data(track, 'trackData', {track: obj});
				mediaelement.loadTextTrack(mediaelem, track, trackData, ($.prop(track, 'default') && $(track).siblings('track[default]')[ADDBACK]()[0] == track));
			} else {
				if(supportTrackMod){
					copyProps.forEach(function(copyProp){
						webshims.defineProperty(obj, copyName[copyProp] || copyProp, {
							value: track[copyProp],
							writeable: false
						});
					});
				}
				obj.cues = mediaelement.createCueList();
				obj.activeCues = obj._shimActiveCues = obj.shimActiveCues = mediaelement.createCueList();
				obj.mode = 'hidden';
				obj.readyState = 2;
			}
		}
		return obj;
	};
	
	
/*
taken from:
Captionator 0.5.1 [CaptionCrunch]
Christopher Giffard, 2011
Share and enjoy

https://github.com/cgiffard/Captionator

modified for webshims
*/
	mediaelement.parseCaptionChunk = (function(){
		// Set up timestamp parsers
		var WebVTTTimestampParser			= /^(\d{2})?:?(\d{2}):(\d{2})\.(\d+)\s+\-\-\>\s+(\d{2})?:?(\d{2}):(\d{2})\.(\d+)\s*(.*)/;
		var GoogleTimestampParser		= /^([\d\.]+)\s+\+([\d\.]+)\s*(.*)/;
		var WebVTTDEFAULTSCueParser		= /^(DEFAULTS|DEFAULT)\s+\-\-\>\s+(.*)/g;
		var WebVTTSTYLECueParser		= /^(STYLE|STYLES)\s+\-\-\>\s*\n([\s\S]*)/g;
		var WebVTTCOMMENTCueParser		= /^(COMMENT|COMMENTS)\s+\-\-\>\s+(.*)/g;
		
		return function(subtitleElement,objectCount){
			var cueDefaults = [];
		
			var subtitleParts, timeIn, timeOut, html, timeData, subtitlePartIndex, cueSettings = "", id, specialCueData;
			var timestampMatch, tmpCue;

			// WebVTT Special Cue Logic
			if ((specialCueData = WebVTTDEFAULTSCueParser.exec(subtitleElement))) {
//				cueDefaults = specialCueData.slice(2).join("");
//				cueDefaults = cueDefaults.split(/\s+/g).filter(function(def) { return def && !!def.length; });
				return null;
			} else if ((specialCueData = WebVTTSTYLECueParser.exec(subtitleElement))) {
				return null;
			} else if ((specialCueData = WebVTTCOMMENTCueParser.exec(subtitleElement))) {
				return null; // At this stage, we don't want to do anything with these.
			}
			
			subtitleParts = subtitleElement.split(/\n/g);
		
			// Trim off any blank lines (logically, should only be max. one, but loop to be sure)
			while (!subtitleParts[0].replace(/\s+/ig,"").length && subtitleParts.length > 0) {
				subtitleParts.shift();
			}
		
			if (subtitleParts[0].match(/^\s*[a-z0-9-\_]+\s*$/ig)) {
				// The identifier becomes the cue ID (when *we* load the cues from file. Programatically created cues can have an ID of whatever.)
				id = String(subtitleParts.shift().replace(/\s*/ig,""));
			}
		
			for (subtitlePartIndex = 0; subtitlePartIndex < subtitleParts.length; subtitlePartIndex ++) {
				var timestamp = subtitleParts[subtitlePartIndex];
				
				if ((timestampMatch = WebVTTTimestampParser.exec(timestamp))) {
					
					// WebVTT
					
					timeData = timestampMatch.slice(1);
					
					timeIn =	parseInt((timeData[0]||0) * 60 * 60,10) +	// Hours
								parseInt((timeData[1]||0) * 60,10) +		// Minutes
								parseInt((timeData[2]||0),10) +				// Seconds
								parseFloat("0." + (timeData[3]||0));		// MS
					
					timeOut =	parseInt((timeData[4]||0) * 60 * 60,10) +	// Hours
								parseInt((timeData[5]||0) * 60,10) +		// Minutes
								parseInt((timeData[6]||0),10) +				// Seconds
								parseFloat("0." + (timeData[7]||0));		// MS
/*
					if (timeData[8]) {
						cueSettings = timeData[8];
					}
*/
				}
				
				// We've got the timestamp - return all the other unmatched lines as the raw subtitle data
				subtitleParts = subtitleParts.slice(0,subtitlePartIndex).concat(subtitleParts.slice(subtitlePartIndex+1));
				break;
			}

			if (!timeIn && !timeOut) {
				// We didn't extract any time information. Assume the cue is invalid!
				webshims.warn("couldn't extract time information: "+[timeIn, timeOut, subtitleParts.join("\n"), id].join(' ; '));
				return null;
			}
/*
			// Consolidate cue settings, convert defaults to object
			var compositeCueSettings =
				cueDefaults
					.reduce(function(previous,current,index,array){
						previous[current.split(":")[0]] = current.split(":")[1];
						return previous;
					},{});
			
			// Loop through cue settings, replace defaults with cue specific settings if they exist
			compositeCueSettings =
				cueSettings
					.split(/\s+/g)
					.filter(function(set) { return set && !!set.length; })
					// Convert array to a key/val object
					.reduce(function(previous,current,index,array){
						previous[current.split(":")[0]] = current.split(":")[1];
						return previous;
					},compositeCueSettings);
			
			// Turn back into string like the TextTrackCue constructor expects
			cueSettings = "";
			for (var key in compositeCueSettings) {
				if (compositeCueSettings.hasOwnProperty(key)) {
					cueSettings += !!cueSettings.length ? " " : "";
					cueSettings += key + ":" + compositeCueSettings[key];
				}
			}
*/
			// The remaining lines are the subtitle payload itself (after removing an ID if present, and the time);
			html = subtitleParts.join("\n");
			tmpCue = new TextTrackCue(timeIn, timeOut, html);
			if(id){
				tmpCue.id = id;
			}
			return tmpCue;
		};
	})();
	
	mediaelement.parseCaptions = function(captionData, track, complete) {
		var subtitles = mediaelement.createCueList();
		var cue, lazyProcess, regWevVTT;
		var startDate;
		var isWEBVTT;
		if (captionData) {
			
			regWevVTT = /^WEBVTT(\s*FILE)?/ig;
			
			lazyProcess = function(i, len){
				
				for(; i < len; i++){
					cue = captionData[i];
					if(regWevVTT.test(cue)){
						isWEBVTT = true;
					} else if(cue.replace(/\s*/ig,"").length){
						if(!isWEBVTT){
							webshims.error('please use WebVTT format. This is the standard');
							complete(null);
							break;
						}
						cue = mediaelement.parseCaptionChunk(cue, i);
						if(cue){
							track.addCue(cue);
						}
					}
					if(startDate < (new Date().getTime()) - 30){
						i++;
						setTimeout(function(){
							startDate = new Date().getTime();
							lazyProcess(i, len);
						}, 90);
						
						break;
					}
				}
				if(i >= len){
					if(!isWEBVTT){
						webshims.error('please use WebVTT format. This is the standard');
					}
					complete(track.cues);
				}
			};
			
			captionData = captionData.replace(/\r\n/g,"\n");
			
			setTimeout(function(){
				captionData = captionData.replace(/\r/g,"\n");
				setTimeout(function(){
					startDate = new Date().getTime();
					captionData = captionData.split(/\n\n+/g);
					lazyProcess(0, captionData.length);
				}, 9);
			}, 9);
			
		} else {
			webshims.error("Required parameter captionData not supplied.");
		}
	};
	
	
	mediaelement.createTrackList = function(mediaelem, baseData){
		baseData = baseData || webshims.data(mediaelem, 'mediaelementBase') || webshims.data(mediaelem, 'mediaelementBase', {});
		if(!baseData.textTracks){
			baseData.textTracks = [];
			webshims.defineProperties(baseData.textTracks, {
				onaddtrack: {value: null},
				onremovetrack: {value: null}
			});
			createEventTarget(baseData.textTracks);
		}
		return baseData.textTracks;
	};
	
	if(!Modernizr.track){
		webshims.defineNodeNamesBooleanProperty(['track'], 'default');
		webshims.reflectProperties(['track'], ['srclang', 'label']);
		
		webshims.defineNodeNameProperties('track', {
			src: {
				//attr: {},
				reflect: true,
				propType: 'src'
			}
		});
	}
	
	webshims.defineNodeNameProperties('track', {
		kind: {
			attr: Modernizr.track ? {
				set: function(value){
					var trackData = webshims.data(this, 'trackData');
					this.setAttribute('data-kind', value);
					if(trackData){
						trackData.attrKind = value;
					}
				},
				get: function(){
					var trackData = webshims.data(this, 'trackData');
					if(trackData && ('attrKind' in trackData)){
						return trackData.attrKind;
					}
					return this.getAttribute('kind');
				}
			} : {},
			reflect: true,
			propType: 'enumarated',
			defaultValue: 'subtitles',
			limitedTo: ['subtitles', 'captions', 'descriptions', 'chapters', 'metadata']
		}
	});
	
	$.each(copyProps, function(i, copyProp){
		var name = copyName[copyProp] || copyProp;
		webshims.onNodeNamesPropertyModify('track', copyProp, function(){
			var trackData = webshims.data(this, 'trackData');
			var track = this;
			if(trackData){
				if(copyProp == 'kind'){
					refreshTrack(this, trackData);
				}
				if(!supportTrackMod){
					trackData.track[name] = $.prop(this, copyProp);
				}
				clearTimeout(trackData.changedTrackPropTimer);
				trackData.changedTrackPropTimer = setTimeout(function(){
					$(track).trigger('updatesubtitlestate');
				}, 1); 
			}
		});
	});		
	
	
	webshims.onNodeNamesPropertyModify('track', 'src', function(val){
		if(val){
			var data = webshims.data(this, 'trackData');
			var media;
			if(data){
				media = $(this).closest('video, audio');
				if(media[0]){
					mediaelement.loadTextTrack(media, this, data);
				}
			}
		}
		
	});
	
	//
	
	webshims.defineNodeNamesProperties(['track'], {
		ERROR: {
			value: 3
		},
		LOADED: {
			value: 2
		},
		LOADING: {
			value: 1
		},
		NONE: {
			value: 0
		},
		readyState: {
			get: function(){
				return ($.prop(this, 'track') || {readyState: 0}).readyState;
			},
			writeable: false
		},
		track: {
			get: function(){
				return mediaelement.createTextTrack($(this).closest('audio, video')[0], this);
			},
			writeable: false
		}
	}, 'prop');
	
	webshims.defineNodeNamesProperties(['audio', 'video'], {
		textTracks: {
			get: function(){
				var media = this;
				var baseData = webshims.data(media, 'mediaelementBase') || webshims.data(media, 'mediaelementBase', {});
				var tracks = mediaelement.createTrackList(media, baseData);
				if(!baseData.blockTrackListUpdate){
					updateMediaTrackList.call(media, baseData, tracks);
				}
				return tracks;
			},
			writeable: false
		},
		addTextTrack: {
			value: function(kind, label, lang){
				var textTrack = mediaelement.createTextTrack(this, {
					kind: dummyTrack.prop('kind', kind || '').prop('kind'),
					label: label || '',
					srclang: lang || ''
				});
				var baseData = webshims.data(this, 'mediaelementBase') || webshims.data(this, 'mediaelementBase', {});
				if (!baseData.scriptedTextTracks) {
					baseData.scriptedTextTracks = [];
				}
				baseData.scriptedTextTracks.push(textTrack);
				updateMediaTrackList.call(this);
				return textTrack;
			}
		}
	}, 'prop');

	
	$(document).on('emptied ended updatetracklist', function(e){
		if($(e.target).is('audio, video')){
			var baseData = webshims.data(e.target, 'mediaelementBase');
			if(baseData){
				clearTimeout(baseData.updateTrackListTimer);
				baseData.updateTrackListTimer = setTimeout(function(){
					updateMediaTrackList.call(e.target, baseData);
				}, 0);
			}
		}
	});
	
	var getNativeReadyState = function(trackElem, textTrack){
		return textTrack.readyState || trackElem.readyState;
	};
	var stopOriginalEvent = function(e){
		if(e.originalEvent){
			e.stopImmediatePropagation();
		}
	};
	var startTrackImplementation = function(){
		if(webshims.implement(this, 'track')){
			var shimedTrack = $.prop(this, 'track');
			var origTrack = this.track;
			var kind;
			var readyState;
			if(origTrack){
				kind = $.prop(this, 'kind');
				readyState = getNativeReadyState(this, origTrack);
				if (origTrack.mode || readyState) {
					shimedTrack.mode = numericModes[origTrack.mode] || origTrack.mode;
				}
				//disable track from showing + remove UI
				if(kind != 'descriptions'){
					origTrack.mode = (typeof origTrack.mode == 'string') ? 'disabled' : 0;
					this.kind = 'metadata';
					$(this).attr({kind: kind});
				}
				
			}
			$(this).on('load error', stopOriginalEvent);
		}
	};
	webshims.addReady(function(context, insertedElement){
		var insertedMedia = insertedElement.filter('video, audio, track').closest('audio, video');
		$('video, audio', context)
			.add(insertedMedia)
			.each(function(){
				updateMediaTrackList.call(this);
			})
			.each(function(){
				if(Modernizr.track){
					var shimedTextTracks = $.prop(this, 'textTracks');
					var origTextTracks = this.textTracks;
					if(shimedTextTracks.length != origTextTracks.length){
						webshims.error("textTracks couldn't be copied");
					}
					
					$('track', this).each(startTrackImplementation);
				}
			})
		;
		insertedMedia.each(function(){
			var media = this;
			var baseData = webshims.data(media, 'mediaelementBase');
			if(baseData){
				clearTimeout(baseData.updateTrackListTimer);
				baseData.updateTrackListTimer = setTimeout(function(){
					updateMediaTrackList.call(media, baseData);
				}, 9);
			}
		});
	});
	
	if(Modernizr.track){
		$('video, audio').trigger('trackapichange');
	}
});