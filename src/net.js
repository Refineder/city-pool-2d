const ROOM_CODE = /^[A-Z0-9]{4}$/;
const HANDSHAKE_TIMEOUT = 12_000;

export function validCode(code) {
  return ROOM_CODE.test(code);
}

export function roomUrl(location) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/games/pool/ws`;
}

export function connectRoom(request, handlers) {
  const socket = new WebSocket(roomUrl(window.location));
  let closed = false;
  let admitted = false;
  const timer = window.setTimeout(() => disconnect(handlers.closed), HANDSHAKE_TIMEOUT);

  function disconnect(onClose) {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    socket.close();
    onClose?.();
  }

  socket.addEventListener('open', () => socket.send(JSON.stringify(request)));
  socket.addEventListener('message', ({ data }) => {
    if (closed || typeof data !== 'string') return;
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'created' || message.type === 'start') {
      admitted = true;
      window.clearTimeout(timer);
    }
    handlers.message(message);
  });
  socket.addEventListener('close', ({ code }) => {
    disconnect(() => handlers.closed(code, admitted));
  });

  return {
    send(message) {
      if (closed || !admitted || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    close() { disconnect(); },
  };
}
