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

const FILTERS = [
  ["all", "All"],
  ["unread", "Unread"],
  ["favourites", "Favourites"],
  ["groups", "Groups"],
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

  if (sameDay(v, new Date())) return "Today";
  if (sameDay(v, yesterday)) return "Yesterday";

  return new Date(v).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

// =====================================
// ICONS (inline SVG, no extra package needed)
// =====================================

const ICONS = {
  chat: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z",
  call: "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  call_end:
    "M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z",
  status:
    "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm0-13a5 5 0 1 0 5 5 5 5 0 0 0-5-5z",
  groups:
    "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  archive:
    "M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z",
  videocam:
    "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z",
  videocam_off:
    "M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z",
  search:
    "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  attach:
    "M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z",
  emoji:
    "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z",
  mic: "M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z",
  mic_off:
    "M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z",
  send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
  lock: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  check: "M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z",
  done_all:
    "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z",
  clock:
    "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
};

function Icon({ name, size = 24 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

function Ticks({ status }) {
  if (status === "pending") {
    return (
      <span className="tick pending">
        <Icon name="clock" size={13} />
      </span>
    );
  }

  if (status === "sent") {
    return (
      <span className="tick">
        <Icon name="check" size={16} />
      </span>
    );
  }

  return (
    <span className={`tick ${status === "read" ? "read" : ""}`}>
      <Icon name="done_all" size={16} />
    </span>
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
  const [filter, setFilter] = useState("all");
  const [topMenu, setTopMenu] = useState(false);
  const [connected, setConnected] = useState(false);
  const [netOnline, setNetOnline] = useState(navigator.onLine);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [showChat, setShowChat] = useState(false);
  const [menu, setMenu] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [file, setFile] = useState(null);
  const [starred, setStarred] = useState([]);
  const [reactions, setReactions] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);

  // AUDIO / VIDEO CALL STATES
  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callError, setCallError] = useState("");

  const isMobile = useMedia("(max-width: 760px)");

  const socketRef = useRef(null);
  const outboxRef = useRef(outbox);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  // WebRTC refs
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const callRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  outboxRef.current = outbox;
  callRef.current = call;

  const my = USERS.find((u) => u.id === me);
  const contacts = USERS.filter((u) => u.id !== me);

  const active = contacts.some((u) => u.id === picked)
    ? picked
    : contacts[0]?.id;

  const person = USERS.find((u) => u.id === active);

  // =====================================
  // MESSAGE FUNCTIONS
  // =====================================

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

  // =====================================
  // WEBRTC CALL FUNCTIONS
  // =====================================

  function stopCallMedia() {
    if (peerRef.current) {
      peerRef.current.ontrack = null;
      peerRef.current.onicecandidate = null;
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.close();
      peerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    pendingCandidatesRef.current = [];

    setLocalStream(null);
    setRemoteStream(null);
    setMicMuted(false);
    setCameraOff(false);
    setCallError("");
    setCall(null);
    callRef.current = null;
  }

  async function getCallMedia(type) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera/microphone access available nahi hai. HTTPS website use karein.",
      );
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === "video",
    });

    localStreamRef.current = stream;
    setLocalStream(stream);

    return stream;
  }

  function createPeer(callId) {
    if (peerRef.current) {
      peerRef.current.close();
    }

    const peer = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
        {
          urls: "stun:stun1.l.google.com:19302",
        },
      ],
    });

    peerRef.current = peer;

    peer.ontrack = (event) => {
      const stream = event.streams?.[0];

      if (stream) {
        setRemoteStream(stream);
      }
    };

    peer.onicecandidate = (event) => {
      if (event.candidate && socketRef.current?.connected) {
        socketRef.current.emit("ice_candidate", {
          callId,
          candidate: event.candidate,
        });
      }
    };

    peer.onconnectionstatechange = () => {
      if (
        peer.connectionState === "failed" ||
        peer.connectionState === "disconnected"
      ) {
        setCallError("Connection weak hai. Dobara connect karne ki koshish karein.");
      }

      if (peer.connectionState === "connected") {
        setCallError("");

        // Call screen par "Connected" dikhane ke liye
        if (callRef.current) {
          const updatedCall = { ...callRef.current, status: "connected" };
          callRef.current = updatedCall;
          setCall(updatedCall);
        }
      }
    };

    return peer;
  }

  async function addLocalTracks(peer, stream) {
    stream.getTracks().forEach((track) => {
      peer.addTrack(track, stream);
    });
  }

  async function flushCandidates() {
    const peer = peerRef.current;

    if (!peer || !peer.remoteDescription) return;

    const candidates = [...pendingCandidatesRef.current];
    pendingCandidatesRef.current = [];

    for (const candidate of candidates) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("ICE candidate error:", error);
      }
    }
  }

  async function startOutgoingOffer(callId) {
    try {
      const peer = peerRef.current;

      if (!peer) {
        throw new Error("Call connection create nahi hua.");
      }

      const offer = await peer.createOffer();

      await peer.setLocalDescription(offer);

      socketRef.current?.emit("webrtc_offer", {
        callId,
        offer,
      });
    } catch (error) {
      console.error("Offer error:", error);
      setCallError(error.message || "Call connect nahi ho payi.");
    }
  }

  async function startCall(type) {
    if (!socketRef.current?.connected) {
      window.alert("Server se connection nahi hai.");
      return;
    }

    if (!active || !online.includes(active)) {
      window.alert("Ye user abhi offline hai.");
      return;
    }

    if (callRef.current) {
      window.alert("Aap already ek call mein hain.");
      return;
    }

    try {
      setCallError("");

      const stream = await getCallMedia(type);

      const newCall = {
        callId: null,
        type,
        direction: "outgoing",
        status: "calling",
        with: active,
      };

      callRef.current = newCall;
      setCall(newCall);

      socketRef.current.emit(
        "call_user",
        {
          to: active,
          callType: type,
        },
        (response) => {
          if (!response?.ok) {
            stopCallMedia();
            window.alert(response?.message || "Call start nahi ho payi.");
            return;
          }

          const updatedCall = {
            ...newCall,
            callId: response.callId,
          };

          callRef.current = updatedCall;
          setCall(updatedCall);

          const peer = createPeer(response.callId);
          addLocalTracks(peer, stream);
        },
      );
    } catch (error) {
      console.error("Start call error:", error);
      stopCallMedia();

      window.alert(
        error.name === "NotAllowedError"
          ? "Camera/microphone permission allow karein."
          : error.message || "Call start nahi ho payi.",
      );
    }
  }

  async function acceptIncomingCall() {
    const currentCall = callRef.current;

    if (!currentCall?.callId) return;

    try {
      setCallError("");

      const stream = await getCallMedia(currentCall.type);
      const peer = createPeer(currentCall.callId);

      await addLocalTracks(peer, stream);

      socketRef.current.emit(
        "accept_call",
        { callId: currentCall.callId },
        (response) => {
          if (!response?.ok) {
            stopCallMedia();
            window.alert(response?.message || "Call accept nahi ho payi.");
            return;
          }

          const updatedCall = {
            ...currentCall,
            direction: "active",
            status: "connecting",
          };

          callRef.current = updatedCall;
          setCall(updatedCall);
        },
      );
    } catch (error) {
      console.error("Accept call error:", error);
      stopCallMedia();

      window.alert(
        error.name === "NotAllowedError"
          ? "Camera/microphone permission allow karein."
          : error.message || "Call accept nahi ho payi.",
      );
    }
  }

  function rejectIncomingCall() {
    const currentCall = callRef.current;

    if (currentCall?.callId) {
      socketRef.current?.emit("reject_call", {
        callId: currentCall.callId,
      });
    }

    stopCallMedia();
  }

  function endCall() {
    const currentCall = callRef.current;

    if (currentCall?.callId && socketRef.current?.connected) {
      socketRef.current.emit("end_call", {
        callId: currentCall.callId,
      });
    }

    stopCallMedia();
  }

  function toggleMic() {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextValue = !micMuted;

    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextValue;
    });

    setMicMuted(nextValue);
  }

  function toggleCamera() {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextValue = !cameraOff;

    stream.getVideoTracks().forEach((track) => {
      track.enabled = !nextValue;
    });

    setCameraOff(nextValue);
  }

  // Attach video streams to video elements
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }

    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }

    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [localStream, remoteStream, call]);

  // =====================================
  // SOCKET CONNECTION
  // =====================================

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

    socket.on("disconnect", () => {
      setConnected(false);

      if (callRef.current) {
        stopCallMedia();
      }
    });

    socket.on("connect_error", () => {
      setConnected(false);
    });

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
            m.id === id
              ? { ...m, text: "", file: null, deleted: true }
              : m,
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

    // INCOMING CALL
    socket.on("incoming_call", (data) => {
      if (callRef.current) {
        socket.emit("reject_call", { callId: data.callId });
        return;
      }

      const incoming = {
        callId: data.callId,
        with: data.from,
        callerName: data.callerName,
        type: data.callType || "audio",
        direction: "incoming",
        status: "ringing",
      };

      callRef.current = incoming;
      setCall(incoming);
      setCallError("");
    });

    // CALL ACCEPTED
    socket.on("call_accepted", async (data) => {
      const currentCall = callRef.current;

      if (!currentCall || currentCall.callId !== data.callId) return;

      const updatedCall = {
        ...currentCall,
        direction: "active",
        status: "connecting",
      };

      callRef.current = updatedCall;
      setCall(updatedCall);

      await startOutgoingOffer(data.callId);
    });

    // CALL REJECTED
    socket.on("call_rejected", () => {
      window.alert("Samne wale user ne call reject kar di.");
      stopCallMedia();
    });

    // RECEIVE WEBRTC OFFER
    socket.on("webrtc_offer", async (data) => {
      try {
        const currentCall = callRef.current;

        if (!currentCall || currentCall.callId !== data.callId) return;

        const peer = peerRef.current;

        if (!peer) return;

        await peer.setRemoteDescription(
          new RTCSessionDescription(data.offer),
        );

        await flushCandidates();

        const answer = await peer.createAnswer();

        await peer.setLocalDescription(answer);

        socket.emit("webrtc_answer", {
          callId: data.callId,
          answer,
        });

        // connection already "connected" ho chuka ho to status wapas na badlein
        if (callRef.current?.status !== "connected") {
          const updatedCall = {
            ...callRef.current,
            status: "connecting",
          };

          callRef.current = updatedCall;
          setCall(updatedCall);
        }
      } catch (error) {
        console.error("Receive offer error:", error);
        setCallError("Call connection mein problem aa gayi.");
      }
    });

    // RECEIVE WEBRTC ANSWER
    socket.on("webrtc_answer", async (data) => {
      try {
        const peer = peerRef.current;

        if (!peer || callRef.current?.callId !== data.callId) return;

        await peer.setRemoteDescription(
          new RTCSessionDescription(data.answer),
        );

        await flushCandidates();

        if (callRef.current?.status !== "connected") {
          const updatedCall = {
            ...callRef.current,
            status: "connecting",
          };

          callRef.current = updatedCall;
          setCall(updatedCall);
        }
      } catch (error) {
        console.error("Receive answer error:", error);
        setCallError("Call answer receive nahi hua.");
      }
    });

    // ICE CANDIDATES
    socket.on("ice_candidate", async (data) => {
      try {
        if (callRef.current?.callId !== data.callId) return;

        const peer = peerRef.current;

        if (!peer || !peer.remoteDescription) {
          pendingCandidatesRef.current.push(data.candidate);
          return;
        }

        await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (error) {
        console.error("ICE candidate receive error:", error);
      }
    });

    // CALL ENDED BY OTHER USER
    socket.on("call_ended", (data) => {
      if (
        !callRef.current ||
        (data?.callId && callRef.current.callId !== data.callId)
      ) {
        return;
      }

      stopCallMedia();
    });

    return () => {
      if (callRef.current?.callId && socket.connected) {
        socket.emit("end_call", {
          callId: callRef.current.callId,
        });
      }

      stopCallMedia();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [me]);

  // =====================================
  // SAVE PENDING MESSAGES
  // =====================================

  useEffect(() => {
    if (me) {
      sessionStorage.setItem(
        "UDTConnect-outbox-" + me,
        JSON.stringify(outbox),
      );
    }
  }, [outbox, me]);

  // =====================================
  // BROWSER NETWORK STATUS
  // =====================================

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
    if (!menu && !confirmDelete && !topMenu) return;

    const handler = (e) => {
      if (e.key === "Escape") {
        setMenu(null);
        setConfirmDelete(null);
        setTopMenu(false);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [menu, confirmDelete, topMenu]);

  // =====================================
  // MESSAGE DATA
  // =====================================

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
          (m) =>
            (m.senderId === user.id && m.receiverId === me) ||
            (m.senderId === me && m.receiverId === user.id),
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
          m.senderId === active &&
          m.receiverId === me &&
          m.status !== "read",
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

  // =====================================
  // LOGIN / LOGOUT
  // =====================================

  function login(id) {
    sessionStorage.setItem("UDTConnect-user", id);
    setMsgs([]);
    setOutbox(loadBox(id));
    setPicked("");
    setShowChat(false);
    setMe(id);
  }

  function logout() {
    if (callRef.current) {
      endCall();
    }

    sessionStorage.removeItem("UDTConnect-user");
    setMsgs([]);
    setOnline([]);
    setOutbox([]);
    setShowChat(false);
    setTopMenu(false);
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

  // =====================================
  // FILE ATTACHMENT
  // =====================================

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

  // =====================================
  // SEND MESSAGE
  // =====================================

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

  // =====================================
  // DELETE MESSAGE
  // =====================================

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

  // =====================================
  // MESSAGE ACTIONS
  // =====================================

  async function messageAction(action) {
    const message = menu;
    setMenu(null);

    if (!message) return;

    if (action === "reply") {
      setReplyTo(message);
      inputRef.current?.focus();
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

  // =====================================
  // LOGIN SCREEN
  // =====================================

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
        </div>
      </main>
    );
  }

  const filtered = contacts
    .filter((user) => {
      if (!user.name.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }

      if (filter === "unread") return (info[user.id]?.unread || 0) > 0;
      if (filter === "favourites" || filter === "groups") return false;

      return true;
    })
    .sort(
      (a, b) =>
        new Date(info[b.id]?.last?.time || 0) -
        new Date(info[a.id]?.last?.time || 0),
    );

  const emptyListText = search
    ? "No chats found"
    : filter === "unread"
      ? "No unread chats"
      : filter === "all"
        ? "No chats yet"
        : "Nothing here yet";

  const isOn = connected && online.includes(active);

  const statusText = !connected
    ? netOnline
      ? "Connecting…"
      : "You are offline"
    : isOn
      ? "Online"
      : lastSeen[active]
        ? `Last seen ${seenText(lastSeen[active])}`
        : "Offline";

  const callPerson = USERS.find((u) => u.id === call?.with);
  const hasContent = !!draft.trim() || !!file;

  // =====================================
  // MAIN UI
  // =====================================

  return (
    <main className="layout">
      {/* LEFT ICON RAIL */}
      <nav className="rail">
        <div className="rail-top">
          <button className="rail-btn active" title="Chats">
            <Icon name="chat" size={22} />
            {totalUnread > 0 && <i className="rail-badge">{totalUnread}</i>}
          </button>
          <button className="rail-btn" title="Calls">
            <Icon name="call" size={22} />
          </button>
          <button className="rail-btn" title="Status">
            <Icon name="status" size={22} />
            <i className="rail-dot" />
          </button>
          <button className="rail-btn" title="Communities">
            <Icon name="groups" size={22} />
          </button>

          <span className="rail-divider" />

          <button className="rail-btn" title="Archived">
            <Icon name="archive" size={22} />
          </button>
        </div>

        <div className="rail-bottom">
          <button
            className="rail-avatar"
            title={`${my?.name || ""} — switch account`}
            onClick={logout}
          >
            <b className={`avatar small ${me}`}>{my?.initials}</b>
          </button>
        </div>
      </nav>

      {/* CHAT LIST */}
      <aside className={`sidebar ${showChat ? "hide" : ""}`}>
        <div className="side-head">
          <h1>Chats</h1>

          <div className="side-actions">
            <div className="menu-wrap">
              <button
                className="icon-btn"
                title="Menu"
                onClick={() => setTopMenu((v) => !v)}
              >
                <Icon name="more" size={22} />
              </button>

              {topMenu && (
                <>
                  <div
                    className="dropdown-backdrop"
                    onClick={() => setTopMenu(false)}
                  />
                  <div className="dropdown">
                    <div className="dropdown-user">{my?.name}</div>
                    <button onClick={logout}>Switch account</button>
                  </div>
                </>
              )}
            </div>

            <button
              className="new-chat"
              title="New chat"
              onClick={() => openChat(contacts[0]?.id)}
            >
              <Icon name="plus" size={22} />
            </button>
          </div>
        </div>

        <label className="search">
          <Icon name="search" size={20} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search or start a new chat"
          />
        </label>

        <div className="chips">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              className={`chip ${filter === key ? "on" : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}

          <button className="chip chip-plus" title="New list">
            <Icon name="plus" size={18} />
          </button>
        </div>

        <div className="contacts">
          {filtered.length === 0 && (
            <div className="list-empty">{emptyListText}</div>
          )}

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
                <span className="avatar-wrap">
                  <b className={`avatar ${user.id}`}>{user.initials}</b>
                  {connected && online.includes(user.id) && (
                    <i className="presence" />
                  )}
                </span>

                <div className="contacttext">
                  <div className="contactrow">
                    <strong>{user.name}</strong>
                    <time>{last ? hm(last.time) : ""}</time>
                  </div>

                  <div className="contactrow">
                    <p>
                      {last && last.senderId === me && !last.deleted && (
                        <Ticks status={last.status} />
                      )}
                      {last?.deleted
                        ? "This message was deleted"
                        : last?.text ||
                          (last?.file
                            ? "📎 Attachment"
                            : "Start a conversation")}
                    </p>

                    {unread > 0 && <em>{unread}</em>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <footer>
          {connected ? (
            <>
              <Icon name="lock" size={13} /> Calls on UDTConnect are{" "}
              <b>encrypted</b>
            </>
          ) : netOnline ? (
            "Connecting to server…"
          ) : (
            "You are offline"
          )}
        </footer>
      </aside>

      {/* CONVERSATION */}
      <section className={`conversation ${showChat ? "show" : ""}`}>
        <header>
          <button className="back" onClick={closeChat} aria-label="Back">
            <Icon name="back" size={24} />
          </button>

          <b className={`avatar ${person?.id}`}>{person?.initials}</b>

          <div className="person">
            <strong>{person?.name}</strong>
            <small className={isOn ? "on" : ""}>{statusText}</small>
          </div>

          <button
            className="icon-btn"
            title="Video call"
            disabled={!isOn || !!call}
            onClick={() => startCall("video")}
          >
            <Icon name="videocam" size={26} />
          </button>

          <button
            className="icon-btn"
            title="Audio call"
            disabled={!isOn || !!call}
            onClick={() => startCall("audio")}
          >
            <Icon name="call" size={22} />
          </button>

          <button className="icon-btn" title="Search">
            <Icon name="search" size={22} />
          </button>

          <button className="icon-btn" title="Menu">
            <Icon name="more" size={22} />
          </button>
        </header>

        {!connected && (
          <div className={`netbar ${netOnline ? "" : "off"}`}>
            {netOnline
              ? "Reconnecting… your messages will be sent automatically."
              : "You are offline. Messages will be sent when you are back online."}
          </div>
        )}

        <div className="messages">
          <div className="enc-notice">
            <Icon name="lock" size={12} /> Calls are encrypted peer-to-peer.
            Messages in this chat are stored on the UDTConnect server.
          </div>

          {chat.map((message, index) => {
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
                    <Icon name="more" size={18} />
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
                      <span className="reaction">{reactions[message.id]}</span>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}

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

          <div className="composer-pill">
            <button
              type="button"
              className="icon-btn"
              aria-label="Attach file"
              title="Attach photo or file"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="attach" size={24} />
            </button>

            <button type="button" className="icon-btn" title="Emoji">
              <Icon name="emoji" size={24} />
            </button>

            <input
              ref={inputRef}
              type="text"
              className="composer-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message"
            />

            {hasContent ? (
              <button className="send-btn" type="submit" aria-label="Send">
                <Icon name="send" size={22} />
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn"
                title="Voice message"
                aria-label="Voice message"
              >
                <Icon name="mic" size={24} />
              </button>
            )}
          </div>
        </form>
      </section>

      {/* =====================================
          CALL SCREEN
      ===================================== */}

      {call && (
        <div
          className={`call-screen ${
            call.type === "video" ? "video-call" : "audio-call"
          }`}
        >
          {call.type === "video" && remoteStream && (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="remote-video"
            />
          )}

          {call.type === "audio" && remoteStream && (
            <audio ref={remoteAudioRef} autoPlay />
          )}

          <div className="call-background-overlay" />

          <div className="call-topbar">
            <div>
              <span className="call-encryption">
                <Icon name="lock" size={13} /> Encrypted call
              </span>
              <small>UDTConnect calls</small>
            </div>

            <button
              className="call-top-close"
              onClick={endCall}
              title="End call"
            >
              ×
            </button>
          </div>

          {call.type === "video" && localStream && (
            <div className="local-video-container">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="local-video"
              />

              {cameraOff && (
                <div className="camera-off-overlay">
                  <Icon name="videocam_off" size={26} />
                  <small>Camera off</small>
                </div>
              )}

              <span className="local-video-label">You</span>
            </div>
          )}

          <div className="call-user-info">
            {!(call.type === "video" && remoteStream) && (
              <div className="call-avatar">
                <span>{callPerson?.initials || "?"}</span>
              </div>
            )}

            <h2>{callPerson?.name || call.callerName || "Unknown user"}</h2>

            <div className="call-status">
              {call.direction === "incoming" ? (
                <>
                  <span className="ringing-dot" />
                  Incoming {call.type} call
                </>
              ) : call.status === "calling" ? (
                "Calling..."
              ) : call.status === "connecting" ? (
                "Connecting..."
              ) : call.status === "connected" ? (
                <>
                  <span className="connected-dot" />
                  Connected
                </>
              ) : (
                "Call in progress"
              )}
            </div>

            {callError && <div className="call-error">{callError}</div>}

            {call.type === "video" && !remoteStream && (
              <p className="video-waiting">Waiting for video...</p>
            )}
          </div>

          <div className="call-bottom">
            {call.direction === "incoming" ? (
              <div className="incoming-controls">
                <button
                  className="call-control reject"
                  onClick={rejectIncomingCall}
                  title="Decline call"
                >
                  <span>
                    <Icon name="call_end" size={28} />
                  </span>
                  <small>Decline</small>
                </button>

                <button
                  className="call-control accept"
                  onClick={acceptIncomingCall}
                  title="Accept call"
                >
                  <span>
                    <Icon name="call" size={26} />
                  </span>
                  <small>Accept</small>
                </button>
              </div>
            ) : (
              <div className="active-controls">
                <button
                  className={`call-control ${micMuted ? "control-active" : ""}`}
                  onClick={toggleMic}
                  title={micMuted ? "Unmute" : "Mute"}
                >
                  <span>
                    <Icon name={micMuted ? "mic_off" : "mic"} size={26} />
                  </span>
                  <small>{micMuted ? "Unmute" : "Mute"}</small>
                </button>

                {call.type === "video" && (
                  <button
                    className={`call-control ${
                      cameraOff ? "control-active" : ""
                    }`}
                    onClick={toggleCamera}
                    title={cameraOff ? "Camera on" : "Camera off"}
                  >
                    <span>
                      <Icon
                        name={cameraOff ? "videocam_off" : "videocam"}
                        size={26}
                      />
                    </span>
                    <small>{cameraOff ? "Camera on" : "Camera off"}</small>
                  </button>
                )}

                <button
                  className="call-control reject end-call"
                  onClick={endCall}
                  title="End call"
                >
                  <span>
                    <Icon name="call_end" size={28} />
                  </span>
                  <small>End</small>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================
          MESSAGE OPTIONS
      ===================================== */}

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

      {/* =====================================
          DELETE CONFIRMATION
      ===================================== */}

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
            <h3 id="delete-confirm-title">Delete message?</h3>

            <p>Are you sure you want to delete this message for everyone?</p>

            <div className="delete-confirm-actions">
              <button
                className="cancel-delete"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>

              <button
                className="confirm-delete"
                onClick={() => deleteMessage("everyone", confirmDelete)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}