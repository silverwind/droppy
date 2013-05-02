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