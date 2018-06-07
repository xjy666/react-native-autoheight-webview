'use strict';

import React, { PureComponent } from 'react';

import {
  findNodeHandle,
  requireNativeComponent,
  Animated,
  DeviceEventEmitter,
  Dimensions,
  StyleSheet,
  Platform,
  UIManager,
  ViewPropTypes,
  WebView,
  PanResponder,
} from 'react-native';

import PropTypes from 'prop-types';

import Immutable from 'immutable';

import { getScript, onHeightUpdated, domMutationObserveScript, getHeight } from './common.js';

const tag = 'RCTAutoHeightWebView';

const MAX_EQUAL_TIME = 20;

const RCTAutoHeightWebView = requireNativeComponent('RCTAutoHeightWebView', AutoHeightWebView, {
  nativeOnly: {
    nativeOnly: {
      onLoadingStart: true,
      onLoadingError: true,
      onLoadingFinish: true,
      messagingEnabled: PropTypes.bool
    }
  }
});

export default class AutoHeightWebView extends PureComponent {
  static propTypes = {
    source: WebView.propTypes.source,
    onHeightUpdated: PropTypes.func,
    customScript: PropTypes.string,
    customStyle: PropTypes.string,
    enableAnimation: PropTypes.bool,
    // if set to false may cause some layout issues (width of container will be than width of screen)
    scalesPageToFit: PropTypes.bool,
    // only works on enable animation
    animationDuration: PropTypes.number,
    // offset of rn webView margin
    heightOffset: PropTypes.number,
    // baseUrl not work in android 4.3 or below version
    enableBaseUrl: PropTypes.bool,
    style: ViewPropTypes.style,
    //  rn WebView callback
    onError: PropTypes.func,
    onLoad: PropTypes.func,
    onLoadStart: PropTypes.func,
    onLoadEnd: PropTypes.func,
    onMessage: PropTypes.func,
    // works if set enableBaseUrl to true; add web/files... to android/app/src/assets/
    files: PropTypes.arrayOf(
      PropTypes.shape({
        href: PropTypes.string,
        type: PropTypes.string,
        rel: PropTypes.string
      })
    )
  };

  static defaultProps = {
    scalesPageToFit: true,
    enableBaseUrl: false,
    enableAnimation: true,
    animationDuration: 555,
    heightOffset: 20
  };

  constructor(props) {
    super(props);
    props.enableAnimation && (this.opacityAnimatedValue = new Animated.Value(0));
    isBelowKitKat && DeviceEventEmitter.addListener('webViewBridgeMessage', this.listenWebViewBridgeMessage);
    this.state = {
      isChangingSource: false,
      height: 0,
      heightOffset: 0,
      script: getScript(props, baseScript)
    };
    this.heightEqualTime = 0;
  }

  componentWillMount() {
    this.panResponder = PanResponder.create({
      // onStartShouldSetPanResponder: (event, gestureState) => this.onStartShouldSetPanResponder(event, gestureState),
      // onMoveShouldSetPanResponderCapture: (event, gestureState) => this.onMoveShouldSetPanResponderCapture(event, gestureState),
      onMoveShouldSetPanResponder: (event, gestureState) => this.onMoveShouldSetPanResponder(event, gestureState),
      onPanResponderTerminate: (event, gestureState) => this.onPanResponderTerminate(event, gestureState),
    });
  }

  onMoveShouldSetPanResponder = (event, gestureState) => {
    const { dx, vy } = gestureState;
    const absDx = Math.abs(dx);
    // const absDy = Math.abs(vy);
    // console.log('onMoveShouldSetPanResponder, dx = ', absDx);
    // console.log('onMoveShouldSetPanResponder, vy = ', absDy);
    return absDx > 10;
  }

  onPanResponderTerminate = (event, gestureState) => {
    const { dx, dy } = gestureState;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    // console.log('onPanResponderTerminate, dx = ', absDy);
    // return dx < 0.1;
  }


  componentDidMount() {
    this.startInterval();
  }

  componentWillReceiveProps(nextProps) {
    // injectedJavaScript only works when webView reload (source changed)
    if (Immutable.is(Immutable.fromJS(this.props.source), Immutable.fromJS(nextProps.source))) {
      return;
    } else {
      this.setState(
        {
          isChangingSource: true,
          height: 0,
          heightOffset: 0
        },
        () => {
          this.startInterval();
          this.setState({ isChangingSource: false });
        }
      );
    }
    this.setState({ script: getScript(nextProps, baseScript) });
  }

  componentWillUnmount() {
    this.stopInterval();
    isBelowKitKat && DeviceEventEmitter.removeListener('webViewBridgeMessage', this.listenWebViewBridgeMessage);
  }

  // below kitkat
  listenWebViewBridgeMessage = body => this.onMessage(body.message);

  // below kitkat
  sendToWebView(message) {
    UIManager.dispatchViewManagerCommand(
      findNodeHandle(this.webView),
      UIManager.RCTAutoHeightWebView.Commands.sendToWebView,
      [String(message)]
    );
  }

  postMessage(data) {
    UIManager.dispatchViewManagerCommand(
      findNodeHandle(this.webView),
      UIManager.RCTAutoHeightWebView.Commands.postMessage,
      [String(data)]
    );
  }

  startInterval() {
    // console.log(tag + 'start interval');
    this.finishInterval = false;
    if (this.interval) return;
    this.interval = setInterval(() => {
      if (!this.finishInterval) {
        // console.log(tag, 'post message get body height');
        isBelowKitKat ? this.sendToWebView('getBodyHeight') : this.postMessage('getBodyHeight');
      }
    }, 500);
  }

  stopInterval() {
    this.finishInterval = true;
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  onMessage = e => {
    // console.log(tag + ' origin message , ', e.nativeEvent);
    if (this.props.onMessage) this.props.onMessage(e);
    const height = parseInt(isBelowKitKat ? e.nativeEvent.message : e.nativeEvent.data);
    if (height === null || height === undefined || this.heightEqualTime > MAX_EQUAL_TIME) return;
    if (height && height === this.state.height) {
      this.heightEqualTime += 1;
    } else if (height !== this.state.height) {
      this.heightEqualTime = 0;
    }
    if (height) {
      const { enableAnimation, animationDuration, heightOffset } = this.props;
      enableAnimation && this.opacityAnimatedValue.setValue(0);
      if (this.heightEqualTime >= MAX_EQUAL_TIME || this.props.source.html) this.stopInterval();
      let nextState = {
        heightOffset,
        height,
      };
      this.setState(nextState,
        () => {
          enableAnimation
            ? Animated.timing(this.opacityAnimatedValue, {
                toValue: 1,
                duration: animationDuration
              }).start(() => onHeightUpdated(height, this.props))
            : onHeightUpdated(height, this.props);
        }
      );
    }
  };

  onLoadingStart = event => {
    const { onLoadStart } = this.props;
    onLoadStart && onLoadStart(event);
  };

  onLoadingError = event => {
    const { onError, onLoadEnd } = this.props;
    onError && onError(event);
    onLoadEnd && onLoadEnd(event);
    console.warn('Encountered an error loading page', event.nativeEvent);
  };

  onLoadingFinish = event => {
    // console.log(tag +' loading finished');
    const { onLoad, onLoadEnd } = this.props;
    onLoad && onLoad(event);
    onLoadEnd && onLoadEnd(event);
  };

  getWebView = webView => (this.webView = webView);

  stopLoading() {
    UIManager.dispatchViewManagerCommand(
      findNodeHandle(this.webView),
      UIManager.RCTAutoHeightWebView.Commands.stopLoading,
      null
    );
  }

  render() {
    const { height, script, isChangingSource, heightOffset } = this.state;
    const { scalesPageToFit, enableAnimation, source, customScript, style, enableBaseUrl } = this.props;
    let webViewSource = source;
    if (enableBaseUrl) {
      webViewSource = Object.assign({}, source, {
        baseUrl: 'file:///android_asset/web/'
      });
    }
    return (
      <Animated.View
        style={[
          styles.container,
          {
            opacity: enableAnimation ? this.opacityAnimatedValue : 1,
            height: height + heightOffset
          },
          style
        ]}
      >
        {isChangingSource ? null : (
          <RCTAutoHeightWebView
            onLoadingStart={this.onLoadingStart}
            onLoadingFinish={this.onLoadingFinish}
            onLoadingError={this.onLoadingError}
            ref={this.getWebView}
            style={styles.webView}
            javaScriptEnabled={true}
            injectedJavaScript={script + customScript}
            scalesPageToFit={scalesPageToFit}
            source={webViewSource}
            onMessage={this.onMessage}
            messagingEnabled={true}
            // below kitkat
            onChange={this.onMessage}
            {...this.panResponder.panHandlers}
          />
        )}
      </Animated.View>
    );
  }
}

const screenWidth = Dimensions.get('window').width;

const isBelowKitKat = Platform.Version < 19;

const styles = StyleSheet.create({
  container: {
    width: screenWidth,
    backgroundColor: 'transparent'
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent'
  }
});

const baseScript = isBelowKitKat
  ? `
    ; (function () {
        AutoHeightWebView.onMessage = function (message) {
            AutoHeightWebView.send(String(document.body.offsetHeight));
        };
        ${domMutationObserveScript}
    } ());
    `
  : `
    ; (function () {
        document.addEventListener('message', function (e) {
            window.postMessage(String(document.body.offsetHeight));
        });
        ${domMutationObserveScript}
    } ());
    `;
