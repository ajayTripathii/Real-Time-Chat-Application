# Connectly Chat

Responsive real-time chat demo built with React, Vite, Express and Socket.IO.

## Run locally

From this `ConnectlyDemo` folder:

```bash
npm install
npm run install:all
npm run dev
```

Open `http://localhost:5173`. The backend runs on port `3000`.

To test presence and chat, open the app in two separate browser profiles (for example, normal Chrome and Incognito) and choose **different accounts**. A user does not appear in their own contact list as an online contact.

## Deploy on Render (one service)

This project is configured to deploy as a single Render Web Service. The Express server serves the built React app and the Socket.IO endpoint from the same domain.

1. Push the complete `ConnectlyDemo` folder to a GitHub repository.
2. In Render, choose **New + → Blueprint** and select that repository.
3. Render reads `render.yaml` and configures the service.
4. Wait for the deploy to finish, then open the generated `https://...onrender.com` URL.
5. Test with two different accounts in two separate browsers/devices.

If creating the service manually, use:
- **Root Directory:** `ConnectlyDemo` (only if this folder is inside a larger repository; otherwise leave blank)
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **Health Check Path:** `/api/health`
- **Environment:** Node

Do not deploy the frontend as a separate static site for this setup. The frontend uses the same origin as the backend in production, which avoids a mismatched API/Socket.IO URL.

## Why online may not show

- Open two sessions and sign in as different accounts. The app has demo accounts: `ajay`, `rahul`, `priya`, `amit`, `neha`.
- Both sessions must open the deployed Render URL, not one local URL and one deployed URL.
- Check `/api/health` on the Render URL; it should return `{"ok":true}`.
- The online state is live Socket.IO presence. It is not a permanent profile setting.
- On Render free instances, the first request after idle may take a little time while the service wakes up.

## Included chat actions

Message options now include emoji reactions, reply, forward, copy and star. The old **Delete for me** and **Delete for everyone** controls have been removed.

## Demo limitations

Messages, online users, reactions and starred messages are held in memory/browser state. A backend restart or redeploy clears server-side messages and presence; this is not a persistent production chat backend. Login is a demo account picker, not real authentication.
