import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./style.css";

const API = import.meta.env.PROD
  ? window.location.origin
  : import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;

const USERS = [
  { id: "ryan", name: "Ryan Rickelton", initials: "RR" },
  { id: "jasprit", name: "Jasprit Bumrah", initials: "JB" },
  { id: "rohit", name: "Rohit Sharma", initials: "RS" },
  { id: "sherphan", name: "Sherphan Rutherford", initials: "SR" },
  { id: "tilak", name: "Tilak Verma", initials: "TV" },
];

const newId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const hm = (v) =>
  v
    ? new Date(v).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const sameDay = (a, b) =>
  new Date(a).toDateString() === new Date(b).toDateString();

const dayLabel = (v) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (sameDay(v, new Date())) return "TODAY";
  if (sameDay(v, yesterday)) return "YESTERDAY";

  return new Date(v)
    .toLocaleDateString([], {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();
};

const seenText = (v) =>
  sameDay(v, new Date())
    ? `today at ${hm(v)}`
    : `${new Date(v).toLocaleDateString([], {
        day: "numeric",
        month: "short",
      })} at ${hm(v)}`;

const loadBox = (user) => {
  try {
    return JSON.parse(
      sessionStorage.getItem("UDTConnect-outbox-" + user) || "[]",
    );
  } catch {
    return [];
  }
};

function useMedia(query) {
  const [value, setValue] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const handler = (e) => setValue(e.matches);

    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [query]);

  return value;
}

function Ticks({ status }) {
  if (status === "pending") {
    return <span className="tick pending">◷</span>;
  }

  if (status === "sent") {
    return <span className="tick">✓</span>;
  }

  return (
    <span className={`tick double ${status === "read" ? "read" : ""}`}>✓✓</span>
  );
}

function Attachment({ file }) {
  if (!file) return null;

  if (file.type?.startsWith("image/")) {
    return (
      <a href={file.data} target="_blank" rel="noreferrer">
        <img className="message-image" src={file.data} alt={file.name} />
      </a>
    );
  }

  if (file.type?.startsWith("video/")) {
    return (
      <video className="message-video" controls>
        <source src={file.data} type={file.type} />
      </video>
    );
  }

  if (file.type?.startsWith("audio/")) {
    return (
      <audio controls className="message-audio">
        <source src={file.data} type={file.type} />
      </audio>
    );
  }

  return (
    <a className="file-attachment" href={file.data} download={file.name}>
      <span className="file-icon">📄</span>
      <span>
        <strong>{file.name}</strong>
        <small>{(file.size / 1024).toFixed(1)} KB</small>
      </span>
      <span>↓</span>
    </a>
  );
}

export default function App() {
  const [me, setMe] = useState(
    () => sessionStorage.getItem("UDTConnect-user") || "",
  );

  const [picked, setPicked] = useState("");
  const [msgs, setMsgs] = useState([]);
  const [outbox, setOutbox] = useState(() =>
    loadBox(sessionStorage.getItem("UDTConnect-user") || ""),
  );

  const [online, setOnline] = useState([]);
  const [lastSeen, setLastSeen] = useState({});
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [connected, setConnected] = useState(false);
  const [netOnline, setNetOnline] = useState(navigator.onLine);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [showChat, setShowChat] = useState(false);
  const [menu, setMenu] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [file, setFile] = useState(null);
  const [starred, setStarred] = useState([]);
  const [reactions, setReactions] = useState({});

  // Custom WhatsApp-style delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(null);

  const isMobile = useMedia("(max-width: 760px)");

  const socketRef = useRef(null);
  const outboxRef = useRef(outbox);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);

  outboxRef.current = outbox;

  const my = USERS.find((u) => u.id === me);
  const contacts = USERS.filter((u) => u.id !== me);

  const active = contacts.some((u) => u.id === picked)
    ? picked
    : contacts[0]?.id;

  const person = USERS.find((u) => u.id === active);

  function upsert(message) {
    setMsgs((old) =>
      old.some((m) => m.id === message.id)
        ? old.map((m) => (m.id === message.id ? message : m))
        : [...old, message],
    );

    setOutbox((old) => old.filter((m) => m.id !== message.id));
  }

  function transmit(socket, message) {
    socket.emit("send_message", message, (response) => {
      if (response?.ok) {
        upsert(response.message);
      } else if (response) {
        setOutbox((old) => old.filter((m) => m.id !== message.id));
        window.alert(response.message || "Message send nahi hua.");
      }
    });
  }

  // Socket connection
  useEffect(() => {
    if (!me) return;

    const socket = io(API, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      maxHttpBufferSize: 12e6,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join", me);

      outboxRef.current.forEach((message) => {
        transmit(socket, message);
      });
    });

    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));

    socket.on("initial_data", (data) => {
      setOnline(data.online || []);
      setLastSeen(data.lastSeen || {});
      setMsgs(data.messages || []);
    });

    socket.on("presence", (data) => {
      setOnline((old) =>
        data.online
          ? [...new Set([...old, data.userId])]
          : old.filter((id) => id !== data.userId),
      );

      if (data.lastSeen) {
        setLastSeen((old) => ({
          ...old,
          [data.userId]: data.lastSeen,
        }));
      }
    });

    socket.on("message_update", upsert);

    socket.on("message_deleted", ({ id, scope }) => {
      if (scope === "me") {
        setMsgs((old) => old.filter((m) => m.id !== id));
        setOutbox((old) => old.filter((m) => m.id !== id));
      }

      if (scope === "everyone") {
        setMsgs((old) =>
          old.map((m) =>
            m.id === id ? { ...m, text: "", file: null, deleted: true } : m,
          ),
        );

        setOutbox((old) => old.filter((m) => m.id !== id));
      }
    });

    socket.on("status_update", ({ ids, status }) => {
      setMsgs((old) =>
        old.map((m) => (ids.includes(m.id) ? { ...m, status } : m)),
      );
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [me]);

  // Save pending messages
  useEffect(() => {
    if (me) {
      sessionStorage.setItem("UDTConnect-outbox-" + me, JSON.stringify(outbox));
    }
  }, [outbox, me]);

  // Browser network status
  useEffect(() => {
    const sync = () => {
      setNetOnline(navigator.onLine);

      const socket = socketRef.current;
      if (!socket) return;

      if (!navigator.onLine && socket.connected) {
        socket.disconnect();
      }

      if (navigator.onLine && !socket.connected) {
        socket.connect();
      }
    };

    const visibility = () => {
      setPageVisible(!document.hidden);
      sync();
    };

    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    document.addEventListener("visibilitychange", visibility);

    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  // Mobile back button
  useEffect(() => {
    const handler = () => setShowChat(false);

    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Escape key closes dialogs
  useEffect(() => {
    if (!menu && !confirmDelete) return;

    const handler = (e) => {
      if (e.key === "Escape") {
        setMenu(null);
        setConfirmDelete(null);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [menu, confirmDelete]);

  // Messages
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

  const info = useMemo(() => {
    return Object.fromEntries(
      contacts.map((user) => {
        const list = allMsgs.filter(
          (m) => m.senderId === user.id || m.receiverId === user.id,
        );

        return [
          user.id,
          {
            last: list[list.length - 1],
            unread: list.filter(
              (m) =>
                m.senderId === user.id &&
                m.receiverId === me &&
                m.status !== "read" &&
                !m.deleted,
            ).length,
          },
        ];
      }),
    );
  }, [allMsgs, contacts, me]);

  const totalUnread = Object.values(info).reduce(
    (total, item) => total + item.unread,
    0,
  );

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
      socketRef.current?.emit("mark_read", {
        senderId: active,
      });
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

  // Login and logout
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
    setOutbox([]);
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
    if (window.history.state?.chat) {
      window.history.back();
    } else {
      setShowChat(false);
    }
  }

  // File attachment
  function selectFile(e) {
    const selected = e.target.files?.[0];
    e.target.value = "";

    if (!selected) return;

    if (selected.size > 7 * 1024 * 1024) {
      window.alert("File size 7 MB se kam honi chahiye.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      setFile({
        name: selected.name,
        type: selected.type || "application/octet-stream",
        size: selected.size,
        data: reader.result,
      });
    };

    reader.onerror = () => window.alert("File read nahi ho payi.");

    reader.readAsDataURL(selected);
  }

  // Send message
  function send(e) {
    e.preventDefault();

    if ((!draft.trim() && !file) || !active) return;

    const text =
      (replyTo ? `↪ ${replyTo.text?.slice(0, 90) || "Attachment"}\n` : "") +
      draft.trim();

    const message = {
      id: newId(),
      senderId: me,
      receiverId: active,
      text,
      file,
      time: new Date().toISOString(),
      status: "pending",
    };

    setOutbox((old) => [...old, message]);
    setDraft("");
    setFile(null);
    setReplyTo(null);

    if (socketRef.current?.connected) {
      transmit(socketRef.current, message);
    }
  }

  // Delete message - no browser confirmation alert
  function deleteMessage(scope, selectedMessage = menu) {
    const message = selectedMessage;

    setMenu(null);
    setConfirmDelete(null);

    if (!message) return;

    const pending = outbox.some((m) => m.id === message.id);
    const confirmed = msgs.some((m) => m.id === message.id);

    if (pending && !confirmed) {
      setOutbox((old) => old.filter((m) => m.id !== message.id));
      return;
    }

    if (!socketRef.current?.connected) {
      window.alert("Server se connection nahi hai. Dobara try karein.");
      return;
    }

    socketRef.current.emit(
      "delete_message",
      { id: message.id, scope },
      (response) => {
        if (!response?.ok) {
          window.alert(response?.message || "Message delete nahi hua.");
        }
      },
    );
  }

  async function messageAction(action) {
    const message = menu;
    setMenu(null);

    if (!message) return;

    if (action === "reply") {
      setReplyTo(message);
      document.querySelector(".composer input")?.focus();
    }

    if (action === "copy") {
      try {
        await navigator.clipboard.writeText(message.text || "");
      } catch {
        window.prompt("Copy message:", message.text || "");
      }
    }

    if (action === "star") {
      setStarred((old) =>
        old.includes(message.id)
          ? old.filter((id) => id !== message.id)
          : [...old, message.id],
      );
    }

    if (action === "react") {
      setReactions((old) => ({
        ...old,
        [message.id]: old[message.id] === "❤️" ? "👍" : "❤️",
      }));
    }

    if (action === "forward") {
      const choices = contacts.map((u) => `${u.id} = ${u.name}`).join("\n");

      const target = window.prompt(`Forward to which account?\n${choices}`);

      if (!target || !contacts.some((u) => u.id === target.trim())) {
        return;
      }

      const forwarded = {
        id: newId(),
        senderId: me,
        receiverId: target.trim(),
        text: `↪ Forwarded\n${message.text || ""}`,
        file: message.file || null,
        time: new Date().toISOString(),
        status: "pending",
      };

      setOutbox((old) => [...old, forwarded]);

      if (socketRef.current?.connected) {
        transmit(socketRef.current, forwarded);
      }
    }
  }

  // Login screen
  if (!me) {
    return (
      <main className="login">
        <div className="loginbox">
          <div className="logo">c</div>
          <h1>UDTConnect</h1>
          <p>Conversations, made simple</p>
          <h3>Choose your account</h3>

          {USERS.map((user) => (
            <button
              key={user.id}
              className="choose"
              onClick={() => login(user.id)}
            >
              <b className={`avatar ${user.id}`}>{user.initials}</b>
              {user.name}
              <span>→</span>
            </button>
          ))}

          <small>
            Open another browser or Incognito window and choose a different user
            to test chat.
          </small>
        </div>
      </main>
    );
  }

  const filtered = contacts.filter((user) =>
    user.name.toLowerCase().includes(search.toLowerCase()),
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

  return (
    <main className="layout">
      <aside className={`sidebar ${showChat ? "hide" : ""}`}>
        <div className="brandrow">
          <div className="logo">c</div>
          <div>
            <h1>UDTConnect</h1>
            <small>Conversations, made simple</small>
          </div>
          <button className="plus" onClick={() => openChat(contacts[0]?.id)}>
            ＋
          </button>
        </div>

        <div className="myprofile">
          <b className={`avatar ${me}`}>{my?.initials}</b>
          <div>
            <strong>{my?.name}</strong>
            <small>
              <i className={connected ? "" : "off"} />
              {connected ? "Available" : "Offline"}
            </small>
          </div>
          <button className="logout" onClick={logout} title="Switch account">
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
          ⌕
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
          {filtered.map((user) => {
            const { last, unread } = info[user.id] || {};

            return (
              <button
                key={user.id}
                className={`contact ${
                  active === user.id ? "selected" : ""
                } ${unread ? "unread" : ""}`}
                onClick={() => openChat(user.id)}
              >
                <b className={`avatar ${user.id}`}>{user.initials}</b>

                <div className="contacttext">
                  <div>
                    <strong>{user.name}</strong>
                    <time>{last ? hm(last.time) : ""}</time>
                  </div>

                  <p>
                    {last && last.senderId === me && (
                      <Ticks status={last.status} />
                    )}
                    {last?.deleted
                      ? "This message was deleted"
                      : last?.text ||
                        (last?.file ? "📎 Attachment" : "Start a conversation")}
                  </p>
                </div>

                {unread > 0 && <em>{unread}</em>}

                {connected && online.includes(user.id) && (
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

      <section className={`conversation ${showChat ? "show" : ""}`}>
        <header>
          <button className="back" onClick={closeChat}>
            ‹
          </button>

          <b className={`avatar ${person?.id}`}>{person?.initials}</b>

          <div className="person">
            <strong>{person?.name}</strong>
            <small>
              {isOn && <i />}
              {statusText}
            </small>
          </div>

          <span className="headicon">⌕</span>
          <span className="headicon">···</span>
        </header>

        {!connected && (
          <div className={`netbar ${netOnline ? "" : "off"}`}>
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
            chat.map((message, index) => {
              const mine = message.senderId === me;

              return (
                <React.Fragment key={message.id}>
                  {(index === 0 ||
                    !sameDay(chat[index - 1].time, message.time)) && (
                    <div className="today">{dayLabel(message.time)}</div>
                  )}

                  <div className={`line ${mine ? "mine" : ""}`}>
                    <button
                      className="more"
                      aria-label="Message options"
                      onClick={() => setMenu(message)}
                    >
                      ···
                    </button>

                    <div
                      className={`bubble ${message.deleted ? "deleted" : ""}`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu(message);
                      }}
                    >
                      {message.deleted ? (
                        <p>
                          <i>This message was deleted</i>
                        </p>
                      ) : (
                        <>
                          {message.text && <p>{message.text}</p>}
                          <Attachment file={message.file} />
                        </>
                      )}

                      {starred.includes(message.id) && (
                        <span className="star-mark">★ Starred</span>
                      )}

                      <small>
                        {hm(message.time)}
                        {mine && <Ticks status={message.status} />}
                      </small>

                      {reactions[message.id] && (
                        <span className="reaction">
                          {reactions[message.id]}
                        </span>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}

          <div ref={bottomRef} />
        </div>

        {replyTo && (
          <div className="reply-preview">
            <div>
              <b>Replying to</b>
              <span>{replyTo.text || replyTo.file?.name || "Attachment"}</span>
            </div>
            <button onClick={() => setReplyTo(null)}>×</button>
          </div>
        )}

        {file && (
          <div className="file-preview">
            <span>📎 {file.name}</span>
            <button onClick={() => setFile(null)}>×</button>
          </div>
        )}

        <form className="composer" onSubmit={send}>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={selectFile}
            accept="*/*"
          />

          <button
            type="button"
            aria-label="Attach file"
            title="Attach photo or file"
            onClick={() => fileRef.current?.click()}
          >
            ＋
          </button>

          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Message ${person?.name.split(" ")[0] || ""}…`}
          />

          <button
            className="send"
            type="submit"
            disabled={!draft.trim() && !file}
            aria-label="Send"
          >
            ➤
          </button>
        </form>
      </section>

      {/* Message options */}
      {menu && (
        <div className="overlay" onClick={() => setMenu(null)}>
          <div
            className="sheet action-sheet"
            role="dialog"
            aria-label="Message actions"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Message options</h3>

            <p className="preview">
              {menu.deleted
                ? "This message was deleted"
                : menu.text || menu.file?.name || "Attachment"}
            </p>

            <div className="quick-reactions">
              {["❤️", "😂", "👍", "😮", "🙏"].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    setReactions((old) => ({
                      ...old,
                      [menu.id]: emoji,
                    }));
                    setMenu(null);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>

            {!menu.deleted && (
              <>
                <button onClick={() => messageAction("reply")}>↩ Reply</button>
                <button onClick={() => messageAction("forward")}>
                  ➦ Forward
                </button>
                <button onClick={() => messageAction("copy")}>▢ Copy</button>
                <button onClick={() => messageAction("star")}>
                  {starred.includes(menu.id)
                    ? "★ Remove star"
                    : "☆ Star message"}
                </button>
                <button onClick={() => messageAction("react")}>♥ React</button>
              </>
            )}

            <button className="danger" onClick={() => deleteMessage("me")}>
              🗑 Delete for me
            </button>

            {menu.senderId === me && !menu.deleted && (
              <button
                className="danger"
                onClick={() => {
                  setConfirmDelete(menu);
                  setMenu(null);
                }}
              >
                🗑 Delete for everyone
              </button>
            )}

            <button onClick={() => setMenu(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* WhatsApp-style Delete Confirmation */}
      {confirmDelete && (
        <div
          className="delete-confirm-overlay"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="delete-confirm-box"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="delete-confirm-icon">🗑</div>

            <h3 id="delete-confirm-title">Delete message?</h3>

            <p>Are you sure you want to delete this message for everyone?</p>

            <div className="delete-confirm-actions">
              <button
                className="cancel-delete"
                onClick={() => setConfirmDelete(null)}
              >
                CANCEL
              </button>

              <button
                className="confirm-delete"
                onClick={() => deleteMessage("everyone", confirmDelete)}
              >
                DELETE
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
