# Connectly Chat

Responsive two-person real-time chat demo using React, Vite, Express and Socket.IO.

## Start
1. Install Node.js 18+.
2. In this folder run `npm install`.
3. Run `npm run install:all`.
4. Run `npm run dev`.
5. Open http://localhost:5173 and choose Ajay Tripathi.
6. Open Chrome Incognito (Ctrl+Shift+N), open the same URL and choose Rahul Sharma.
7. Send messages between both windows.

Test on your phone: open `http://<your-PC-IP>:5173` (same Wi-Fi). The frontend automatically talks to the backend on the same host.

## Features
- **Ticks:** clock = sending, ✓ = sent, ✓✓ grey = delivered, ✓✓ blue = read. A message is "read" only when that chat is actually open on screen (on mobile: chat screen open, tab visible).
- **Unread:** unread badge, bold chat name, and `(n)` in the browser tab title.
- **Delete:** tap the ⌄ button next to a message (or right-click it).
  - *Delete for me* removes it only from your side (any message).
  - *Delete for everyone* is only for your own messages; both sides see "This message was deleted".
- **Online / offline:** live presence with "last seen", multi-tab safe, 3 s grace so a page refresh does not flash offline.
- **Offline sending:** if you are offline, messages are queued (clock icon) and sent automatically when you reconnect. If the receiver is offline, the message stays ✓ and becomes ✓✓ when they come online.
- **Responsive:** phone (list ⇄ chat screens, back button works), tablet, desktop, landscape, notch safe-areas.

Messages are kept in backend memory and reset when the backend restarts. This is a learning/demo app, not production authentication.
