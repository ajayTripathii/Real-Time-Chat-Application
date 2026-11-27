import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

// Uses the same host the page was opened from, so it also works from a phone on your Wi-Fi.
const API =
  import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;
const USERS = [
  { id: "ajay", name: "Ajay Tripathi", initials: "AT" },
  { id: "rahul", name: "Rohit Sharma", initials: "RS" },
  { id: "priya", name: "Virat Kohli", initials: "VK" },
  { id: "amit", name: "Jasprit Bumrah", initials: "JB" },
  { id: "neha", name: "Yasashwi Jaiswal", initials: "YJ" },
];
const MOBILE_Q = "(max-width: 760px)";

const hm = (v) =>
  v
    ? new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
const sameDay = (a, b) =>
  new Date(a).toDateString() === new Date(b).toDateString();
const dayLabel = (v) => {
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (sameDay(v, new Date())) return "TODAY";
  if (sameDay(v, yest)) return "YESTERDAY";
  return new Date(v)
    .toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })
    .toUpperCase();
};
const seenText = (v) =>
  sameDay(v, new Date())
    ? `today at ${hm(v)}`
    : `${new Date(v).toLocaleDateString([], { day: "numeric", month: "short" })} at ${hm(v)}`;
const newId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const loadBox = (u) => {
  try {
    return JSON.parse(sessionStorage.getItem("UDTConnect-outbox-" + u) || "[]");
  } catch {
    return [];
  }
};

function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = (e) => setM(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [q]);
  return m;
}

// pending = clock, sent = ✓, delivered = ✓✓ (grey), read = ✓✓ (blue)
function Ticks({ status }) {
  const label =
    { pending: "Sending", sent: "Sent", delivered: "Delivered", read: "Read" }[
      status
    ] || "Sent";
  return (
    <svg
      className={"tick " + status}
      viewBox="0 0 18 12"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {status === "pending" ? (
        <>
          <circle cx="9" cy="6" r="4.6" />
          <path d="M9 3.6V6l1.7 1.1" />
        </>
      ) : status === "sent" ? (
        <path d="M3 6.5l3 3L12 2.5" />
      ) : (
        <>
          <path d="M1.5 6.5l3 3L10.5 2.5" />
          <path d="M6 6.5l3 3 6-7" />
        </>
      )}
    </svg>
  );
}

export default function App() {
  const [me, setMe] = useState(
    () => sessionStorage.getItem("UDTConnect-user") || "",
  );
  const [picked, setPicked] = useState("");
  const [msgs, setMsgs] = useState([]); // confirmed by server
  const [outbox, setOutbox] = useState(() =>
    loadBox(sessionStorage.getItem("UDTConnect-user") || ""),
  ); // waiting to be sent
  const [online, setOnline] = useState([]);
  const [lastSeen, setLastSeen] = useState({});
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [connected, setConnected] = useState(false);
  const [hasConnected, setHasConnected] = useState(false);
  const [netOnline, setNetOnline] = useState(navigator.onLine);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [showChat, setShowChat] = useState(false); // mobile only: chat screen vs list screen
  const [menu, setMenu] = useState(null); // message selected for delete
  const isMobile = useMedia(MOBILE_Q);

  const socketRef = useRef(null);
  const outboxRef = useRef(outbox);
  const bottomRef = useRef(null);
  outboxRef.current = outbox;

  const my = USERS.find((u) => u.id === me);
  const contacts = USERS.filter((u) => u.id !== me);
  const active = contacts.some((u) => u.id === picked)
    ? picked
    : contacts[0]?.id;
  const person = USERS.find((u) => u.id === active);

  // ---------- message plumbing ----------
  const upsert = (m) => {
    setMsgs((old) =>
      old.some((x) => x.id === m.id)
        ? old.map((x) => (x.id === m.id ? m : x))
        : [...old, m],
    );
    setOutbox((o) => o.filter((x) => x.id !== m.id));
  };
  const transmit = (s, m) =>
    s.emit(
      "send_message",
      { id: m.id, receiverId: m.receiverId, text: m.text },
      (res) => {
        if (res?.ok) upsert(res.message);
        else if (res) setOutbox((o) => o.filter((x) => x.id !== m.id)); // server rejected it
      },
    );

  // One socket per logged-in user (NOT per chat), so presence stays stable.
  useEffect(() => {
    if (!me) return;
    const s = io(API);
    socketRef.current = s;
    s.on("connect", () => {
      setConnected(true);
      setHasConnected(true);
      s.emit("join", me);
      outboxRef.current.forEach((m) => transmit(s, m)); // flush everything typed while offline
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));
    s.on("initial_data", (d) => {
      setOnline(d.online || []);
      setLastSeen(d.lastSeen || {});
      setMsgs(d.messages || []);
    });
    s.on("presence", (d) => {
      setOnline((old) =>
        d.online
          ? [...new Set([...old, d.userId])]
          : old.filter((x) => x !== d.userId),
      );
      if (d.lastSeen) setLastSeen((l) => ({ ...l, [d.userId]: d.lastSeen }));
    });
    s.on("message_update", upsert);
    s.on("status_update", ({ ids, status }) =>
      setMsgs((old) =>
        old.map((m) => (ids.includes(m.id) ? { ...m, status } : m)),
      ),
    );
    s.on("message_deleted", ({ id, scope }) =>
      setMsgs((old) =>
        scope === "me"
          ? old.filter((m) => m.id !== id)
          : old.map((m) =>
              m.id === id ? { ...m, deleted: true, text: "" } : m,
            ),
      ),
    );
    return () => {
      s.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [me]);

  useEffect(() => {
    if (me)
      sessionStorage.setItem("UDTConnect-outbox-" + me, JSON.stringify(outbox));
  }, [outbox, me]);

  // browser online/offline + tab visibility
  useEffect(() => {
    const sync = () => {
      setNetOnline(navigator.onLine);
      const s = socketRef.current;
      if (!s) return;
      if (!navigator.onLine && s.connected) s.disconnect(); // show offline immediately
      if (navigator.onLine && !s.connected) s.connect(); // reconnect immediately
    };
    const vis = () => {
      setPageVisible(!document.hidden);
      sync();
    };
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  // phone back button goes from chat -> list
  useEffect(() => {
    const h = () => setShowChat(false);
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const k = (e) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [menu]);

  // ---------- derived data ----------
  const allMsgs = useMemo(
    () =>
      [...msgs, ...outbox.filter((o) => !msgs.some((m) => m.id === o.id))].sort(
        (a, b) => new Date(a.time) - new Date(b.time),
      ),
    [msgs, outbox],
  );
  const chat = useMemo(
    () =>
      allMsgs.filter(
        (m) =>
          (m.senderId === me && m.receiverId === active) ||
          (m.senderId === active && m.receiverId === me),
      ),
    [allMsgs, me, active],
  );
  const info = useMemo(
    () =>
      Object.fromEntries(
        contacts.map((u) => {
          const list = allMsgs.filter(
            (m) => m.senderId === u.id || m.receiverId === u.id,
          );
          return [
            u.id,
            {
              last: list[list.length - 1],
              unread: list.filter(
                (m) => m.senderId === u.id && m.status !== "read" && !m.deleted,
              ).length,
            },
          ];
        }),
      ),
    [allMsgs, me],
  );
  const totalUnread = Object.values(info).reduce((n, i) => n + i.unread, 0);

  // A message counts as READ only when its chat is really on screen.
  const canRead = connected && pageVisible && (!isMobile || showChat);
  useEffect(() => {
    if (
      canRead &&
      active &&
      msgs.some(
        (m) =>
          m.senderId === active && m.receiverId === me && m.status !== "read",
      )
    ) {
      socketRef.current?.emit("mark_read", { senderId: active });
    }
  }, [canRead, msgs, active, me]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.length, active]);
  useEffect(() => {
    document.title =
      (totalUnread ? `(${totalUnread}) ` : "") +
      "UDTConnect — Conversations, made simple";
  }, [totalUnread]);

  // ---------- actions ----------
  function login(id) {
    sessionStorage.setItem("UDTConnect-user", id);
    setMsgs([]);
    setOutbox(loadBox(id));
    setPicked("");
    setShowChat(false);
    setMe(id);
  }
  function logout() {
    sessionStorage.removeItem("UDTConnect-user");
    setMsgs([]);
    setOnline([]);
    setShowChat(false);
    setMe("");
  }
  function openChat(id) {
    setPicked(id);
    if (isMobile && !showChat) {
      setShowChat(true);
      window.history.pushState({ chat: true }, "");
    }
  }
  function closeChat() {
    if (window.history.state?.chat) window.history.back();
    else setShowChat(false);
  }
  function send(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !active) return;
    const m = {
      id: newId(),
      senderId: me,
      receiverId: active,
      text,
      time: new Date().toISOString(),
      status: "pending",
    };
    setOutbox((o) => [...o, m]);
    setDraft("");
    if (socketRef.current?.connected) transmit(socketRef.current, m);
  }
  function remove(scope) {
    const m = menu;
    setMenu(null);
    if (!m) return;
    if (m.status === "pending")
      setOutbox((o) => o.filter((x) => x.id !== m.id)); // not sent yet: just cancel
    else socketRef.current?.emit("delete_message", { id: m.id, scope });
  }

  // ---------- login screen ----------
  if (!me)
    return (
      <main className="login">
        <div className="loginbox">
          <div className="logo">c</div>
          <h1>UDTConnect</h1>
          <p>Conversations, made simple</p>
          <h3>Choose your account</h3>
          {USERS.map((u) => (
            <button key={u.id} className="choose" onClick={() => login(u.id)}>
              <b className={"avatar " + u.id}>{u.initials}</b>
              {u.name}
              <span>→</span>
            </button>
          ))}
         
        </div>
      </main>
    );

  const filtered = contacts.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase()),
  );
  const isOn = connected && online.includes(active);
  const statusText = !connected
    ? netOnline
      ? "Connecting…"
      : "You are offline"
    : isOn
      ? "Online"
      : lastSeen[active]
        ? `Offline · last seen ${seenText(lastSeen[active])}`
        : "Offline";
  const menuMine = menu && menu.senderId === me;

  return (
    <main className="layout">
      <aside className={"sidebar " + (showChat ? "hide" : "")}>
        <div className="brandrow">
          <div className="logo">c</div>
          <div>
            <h1>UDTConnect</h1>
            <small>Conversations, made simple</small>
          </div>
          <button
            className="plus"
            onClick={() => openChat(contacts[0]?.id)}
            aria-label="New chat"
          >
            ＋
          </button>
        </div>
        <div className="myprofile">
          <b className={"avatar " + me}>{my?.initials}</b>
          <div>
            <strong>{my?.name}</strong>
            <small>
              <i className={connected ? "" : "off"} />
              {connected ? "Available" : "Offline"}
            </small>
          </div>
          <button
            className="logout"
            onClick={logout}
            title="Switch account"
            aria-label="Switch account"
          >
            ⎋
          </button>
        </div>
        <div className="heading">
          <div>
            <h2>Messages</h2>
            <small>Your conversations</small>
          </div>
          <span>⌕</span>
        </div>
        <label className="search">
          ⌕{" "}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations"
          />
        </label>
        <div className="all">
          ALL CHATS <b>{contacts.length}</b>
        </div>
        <div className="contacts">
          {filtered.map((u) => {
            const { last, unread } = info[u.id] || {};
            return (
              <button
                key={u.id}
                className={
                  "contact " +
                  (active === u.id ? "selected " : "") +
                  (unread ? "unread" : "")
                }
                onClick={() => openChat(u.id)}
              >
                <b className={"avatar " + u.id}>{u.initials}</b>
                <div className="contacttext">
                  <div>
                    <strong>{u.name}</strong>
                    <time>{last ? hm(last.time) : ""}</time>
                  </div>
                  <p>
                    {last && last.senderId === me && !last.deleted && (
                      <Ticks status={last.status} />
                    )}
                    {last
                      ? last.deleted
                        ? "🚫 Message deleted"
                        : last.text
                      : "Start a conversation"}
                  </p>
                </div>
                {unread > 0 && <em>{unread}</em>}
                {connected && online.includes(u.id) && (
                  <i className="presence" />
                )}
              </button>
            );
          })}
        </div>
        <footer>
          <i className={connected ? "good" : ""} />
          {connected
            ? "Connected"
            : netOnline
              ? "Connecting to server…"
              : "You are offline"}
        </footer>
      </aside>

      <section className={"conversation " + (showChat ? "show" : "")}>
        <header>
          <button className="back" onClick={closeChat} aria-label="Back">
            ‹
          </button>
          <b className={"avatar " + person?.id}>{person?.initials}</b>
          <div className="person">
            <strong>{person?.name}</strong>
            <small>
              {isOn && <i />}
              {statusText}
            </small>
          </div>
          <button className="headicon">⌕</button>
          <button className="headicon">···</button>
        </header>
        {!connected && (hasConnected || !netOnline) && (
          <div className={"netbar " + (netOnline ? "" : "off")}>
            {netOnline
              ? "Reconnecting… your messages will be sent automatically."
              : "You are offline. Messages will be sent when you are back online."}
          </div>
        )}

        <div className="messages">
          {chat.length === 0 ? (
            <div className="empty">
              <div>✦</div>
              <h3>Start a conversation</h3>
              <p>
                Say hello to {person?.name.split(" ")[0]} and make their day.
              </p>
            </div>
          ) : (
            chat.map((m, i) => {
              const mine = m.senderId === me;
              return (
                <React.Fragment key={m.id}>
                  {(i === 0 || !sameDay(chat[i - 1].time, m.time)) && (
                    <div className="today">{dayLabel(m.time)}</div>
                  )}
                  <div className={"line " + (mine ? "mine" : "")}>
                    <button
                      className="more"
                      aria-label="Message options"
                      onClick={() => setMenu(m)}
                    >
                      ⌄
                    </button>
                    <div
                      className={"bubble " + (m.deleted ? "deleted" : "")}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu(m);
                      }}
                    >
                      <p>
                        {m.deleted
                          ? mine
                            ? "🚫 You deleted this message"
                            : "🚫 This message was deleted"
                          : m.text}
                      </p>
                      <small>
                        {hm(m.time)}
                        {mine && !m.deleted && <Ticks status={m.status} />}
                      </small>
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <form className="composer" onSubmit={send}>
          <button type="button" aria-label="Attach">
            ＋
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Message ${person?.name.split(" ")[0] || ""}…${connected ? "" : " (sends when online)"}`}
          />
          <button
            className="send"
            disabled={!draft.trim()}
            onMouseDown={(e) => e.preventDefault()}
            aria-label="Send"
          >
            ➤
          </button>
        </form>
      </section>

      {menu && (
        <div className="overlay" onClick={() => setMenu(null)}>
          <div
            className="sheet"
            role="dialog"
            aria-label="Delete message"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Delete message?</h3>
            <p className="preview">
              {menu.deleted ? "This message was deleted" : menu.text}
            </p>
            {!connected && menu.status !== "pending" && (
              <small>You are offline — connect to delete messages.</small>
            )}
            <button
              disabled={!connected && menu.status !== "pending"}
              onClick={() => remove("me")}
            >
              Delete for me
            </button>
            {menuMine && !menu.deleted && menu.status !== "pending" && (
              <button
                className="danger"
                disabled={!connected}
                onClick={() => remove("everyone")}
              >
                Delete for everyone
              </button>
            )}
            <button onClick={() => setMenu(null)}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  );
}
