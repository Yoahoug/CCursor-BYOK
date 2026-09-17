/**
 * 注入到面板 HTML 的客户端垫片（dev-only）
 *
 * 真实 webview 里 `acquireVsCodeApi()` 由 VS Code 宿主注入，负责跨 iframe
 * 收发消息。预览里没有宿主，这个垫片顶替它的位置：
 *   postMessage(宿主方向) → 经由 WebSocket 转发到 Node 侧的 PanelProvider
 *   宿主方向 postMessage → 以 window message 形式派发，与真实 webview 一致
 *
 * app.ts 监听的是 `window.addEventListener('message')` 并读 `ev.data`，
 * 所以这里必须用 window.postMessage 派发，不能直接调回调。
 */
/* eslint-disable no-undef */
(function bootstrapPreviewBridge() {
  var params = new URLSearchParams(location.search)
  var sessionId = params.get('sid') || ''
  var pending = []
  var socket = null

  function logToShell(direction, payload) {
    if (window.parent === window)
      return
    try {
      window.parent.postMessage({ __devLog: true, direction: direction, payload: payload }, '*')
    }
    catch {
      /* 跨域或结构不可序列化时忽略，不影响面板本身 */
    }
  }

  function connect() {
    var protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    socket = new WebSocket(protocol + '://' + location.host + '/__ws?sid=' + encodeURIComponent(sessionId))

    socket.onopen = function () {
      while (pending.length > 0)
        socket.send(pending.shift())
    }

    socket.onmessage = function (event) {
      var message
      try {
        message = JSON.parse(event.data)
      }
      catch {
        return
      }

      if (message && message.__dev === 'reload') {
        location.reload()
        return
      }

      logToShell('in', message)
      window.postMessage(message, '*')
    }

    socket.onclose = function () {
      // 宿主侧重建（文件改动触发重新打包）后自动重连，避免手动刷新
      setTimeout(connect, 800)
    }
  }

  connect()

  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (message) {
        var serialized = JSON.stringify(message)
        logToShell('out', message)
        if (socket && socket.readyState === WebSocket.OPEN)
          socket.send(serialized)
        else
          pending.push(serialized)
      },
      getState: function () {
        return undefined
      },
      setState: function (value) {
        return value
      },
    }
  }
})()
