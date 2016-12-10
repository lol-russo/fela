/* @flow weak */
import cssifyFontFace from './utils/cssifyFontFace'
import cssifyKeyframe from './utils/cssifyKeyframe'
import cssifyMediaQueryRules from './utils/cssifyMediaQueryRules'

import generateAnimationName from './utils/generateAnimationName'
import generateClassName from './utils/generateClassName'
import generateCombinedMediaQuery from './utils/generateCombinedMediaQuery'
import generateCSSDeclaration from './utils/generateCSSDeclaration'
import generateCSSRule from './utils/generateCSSRule'
import generateCSSSelector from './utils/generateCSSSelector'
import cssifyStaticStyle from './utils/cssifyStaticStyle'
import generateStaticReference from './utils/generateStaticReference'

import isAttributeSelector from './utils/isAttributeSelector'
import isPseudoSelector from './utils/isPseudoSelector'
import isMediaQuery from './utils/isMediaQuery'

import applyMediaRulesInOrder from './utils/applyMediaRulesInOrder'
import processStyleWithPlugins from './utils/processStyleWithPlugins'
import toCSSString from './utils/toCSSString'
import checkFontFormat from './utils/checkFontFormat'

import { STATIC_TYPE, RULE_TYPE, KEYFRAME_TYPE, FONT_TYPE } from './utils/styleTypes'

export default function createRenderer(config = { }) {
  let renderer = {
    listeners: [],
    keyframePrefixes: config.keyframePrefixes || [ '-webkit-', '-moz-' ],
    plugins: config.plugins || [ ],

    prettySelectors: config.prettySelectors,
    mediaQueryOrder: config.mediaQueryOrder || [ ],

    clear() {
      renderer.fontFaces = ''
      renderer.keyframes = ''
      renderer.statics = ''
      renderer.rules = ''
      // apply media rules in an explicit order to ensure
      // correct media query execution order
      renderer.mediaRules = applyMediaRulesInOrder(renderer.mediaQueryOrder)
      renderer.rendered = [ ]
      renderer.uniqueRuleIdentifier = 0
      renderer.uniqueKeyframeIdentifier = 0
      // use a flat cache object with pure string references
      // to achieve maximal lookup performance and memoization speed
      renderer.cache = { }

      // initial change emit to enforce a clear start
      renderer._emitChange({ type: 'clear' })
    },

    renderRule(rule, props = { }) {
      const processedStyle = processStyleWithPlugins(rule(props), renderer.plugins, RULE_TYPE)
      return renderer._renderStyleToClassNames(processedStyle).slice(1)
    },

    _renderStyleToClassNames(style, pseudo = '', media = '') {
      let classNames = ''

      for (let property in style) {
        const value = style[property]
        if (value instanceof Object) {
          if (isPseudoSelector(property) || isAttributeSelector(property)) {
            classNames += renderer._renderStyleToClassNames(value, pseudo + property, media)
          } else if (isMediaQuery(property)) {
            const combinedMediaQuery = generateCombinedMediaQuery(media, property.slice(6).trim())
            classNames += renderer._renderStyleToClassNames(value, pseudo, combinedMediaQuery)
          } else {
            // TODO: warning
          }
        } else {
          const delcarationReference = media + pseudo + property + value
          if (!renderer.cache[delcarationReference]) {
            let className = generateClassName(++renderer.uniqueRuleIdentifier)

            renderer.cache[delcarationReference] = className

            const cssDeclaration = generateCSSDeclaration(property, value)
            const selector = generateCSSSelector(className, pseudo)
            const cssRule = generateCSSRule(selector, cssDeclaration)

            if (media) {
              if (!renderer.mediaRules.hasOwnProperty(media)) {
                renderer.mediaRules[media] = ''
              }
              renderer.mediaRules[media] += cssRule
            } else {
              renderer.rules += cssRule
            }

            renderer._emitChange({
              selector: selector,
              declaration: cssDeclaration,
              media: media,
              type: RULE_TYPE
            })
          }

          classNames += ' ' + renderer.cache[delcarationReference]
        }
      }

      return classNames
    },


    renderKeyframe(keyframe, props = { }) {
      const resolvedKeyframe = keyframe(props)
      const keyframeReference = JSON.stringify(resolvedKeyframe)

      if (!renderer.cache[keyframeReference]) {
        // use another unique identifier to ensure minimal css markup
        const animationName = generateAnimationName(++renderer.uniqueKeyframeIdentifier)

        const processedKeyframe = processStyleWithPlugins(resolvedKeyframe, renderer.plugins, KEYFRAME_TYPE)
        const cssKeyframe = cssifyKeyframe(processedKeyframe, animationName, renderer.keyframePrefixes)
        renderer.cache[keyframeReference] = animationName
        renderer.keyframes += cssKeyframe

        renderer._emitChange({
          name: animationName,
          keyframe: cssKeyframe,
          type: KEYFRAME_TYPE
        })
      }

      return renderer.cache[keyframeReference]
    },

    renderFont(family, files, properties = { }) {
      const fontReference = family + JSON.stringify(properties)

      if (!renderer.cache[fontReference]) {
        const fontFamily = toCSSString(family)

        // TODO: proper font family generation with error proofing
        const fontFace = {
          ...properties,
          src: files.map(src => 'url(\'' + src + '\') format(\'' + checkFontFormat(src) + '\')').join(','),
          fontFamily: fontFamily
        }

        const cssFontFace = cssifyFontFace(fontFace)
        renderer.cache[fontReference] = fontFamily
        renderer.fontFaces += cssFontFace

        renderer._emitChange({
          fontFamily: fontFamily,
          fontFace: cssFontFace,
          type: FONT_TYPE
        })
      }

      return renderer.cache[fontReference]
    },

    renderStatic(staticStyle, selector) {
      const staticReference = generateStaticReference(staticStyle, selector)

      if (!renderer.cache[staticReference]) {
        const cssDeclarations = cssifyStaticStyle(staticStyle, renderer.plugins)
        renderer.cache[staticReference] = true

        if (typeof staticStyle === 'string') {
          renderer.statics += cssDeclarations
          renderer._emitChange({
            type: STATIC_TYPE,
            css: cssDeclarations
          })
        } else {
          renderer.statics += generateCSSRule(selector, cssDeclarations)
          renderer._emitChange({
            selector: selector,
            declaration: cssDeclarations,
            type: RULE_TYPE,
            media: ''
          })
        }
      }
    },

    renderToString() {
      let css = renderer.fontFaces + renderer.statics + renderer.keyframes + renderer.rules

      for (let media in renderer.mediaRules) {
        css += cssifyMediaQueryRules(media, renderer.mediaRules[media])
      }

      return css
    },

    subscribe(callback) {
      renderer.listeners.push(callback)
      return {
        unsubscribe: () => renderer.listeners.splice(renderer.listeners.indexOf(callback), 1)
      }
    },

    _emitChange(change) {
      for (let i = 0, len = renderer.listeners.length; i < len; ++i) {
        renderer.listeners[i](change)
      }
    }
  }

  // initial setup
  renderer.keyframePrefixes.push('')
  renderer.clear()

  if (config.enhancers) {
    for (let i = 0, len = config.enhancers.length; i < len; ++i) {
      renderer = config.enhancers[i](renderer)
    }
  }

  return renderer
}
