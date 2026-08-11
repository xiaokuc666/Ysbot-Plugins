function stringId(value) {
  return value === undefined || value === null ? undefined : String(value);
}

function roleFromSender(sender) {
  const role = sender?.role;
  if (role === "owner" || role === "admin") return role;
  return role || "member";
}

function normalizeActor(sender, userId) {
  const id = stringId(userId ?? sender?.user_id ?? sender?.id);
  const role = roleFromSender(sender);
  return {
    id,
    origin: "qq",
    admin: role === "admin" || role === "owner",
    roles: role ? [role] : [],
  };
}

function normalizeScene(event) {
  if (event.message_type === "group") {
    return { type: "group", id: stringId(event.group_id) };
  }
  return { type: "private", id: stringId(event.user_id) };
}

export function normalizeOneBotMessage(event) {
  const id = stringId(
    event.message_id ?? `${event.post_type}-${event.time}-${event.user_id}`,
  );
  return {
    id,
    type: "message",
    message_type: event.message_type,
    group_id: stringId(event.group_id),
    user_id: stringId(event.user_id),
    sender: {
      id: stringId(event.sender?.user_id ?? event.user_id),
      nickname: event.sender?.nickname || "",
      card: event.sender?.card || "",
      role: event.sender?.role || "member",
    },
    message: event.message ?? [],
    raw_message: event.raw_message ?? "",
    raw: event,
    timestamp: event.time ?? Math.floor(Date.now() / 1000),
    actor: normalizeActor(event.sender, event.user_id),
    scene: normalizeScene(event),
  };
}

export function normalizeOneBotNotice(event) {
  return {
    id: stringId(event.message_id ?? `${event.post_type}-${event.time}`),
    type: "notice",
    notice_type: event.notice_type,
    group_id: stringId(event.group_id),
    user_id: stringId(event.user_id),
    operator_id: stringId(event.operator_id),
    raw: event,
    timestamp: event.time ?? Math.floor(Date.now() / 1000),
    actor: event.user_id
      ? normalizeActor({ role: "member" }, event.user_id)
      : null,
    scene: event.group_id
      ? { type: "group", id: stringId(event.group_id) }
      : null,
  };
}

export function normalizeOneBotRequest(event) {
  return {
    id: stringId(event.flag ?? `${event.post_type}-${event.time}`),
    type: "request",
    request_type: event.request_type,
    group_id: stringId(event.group_id),
    user_id: stringId(event.user_id),
    comment: event.comment || "",
    raw: event,
    timestamp: event.time ?? Math.floor(Date.now() / 1000),
    actor: event.user_id
      ? normalizeActor({ role: "member" }, event.user_id)
      : null,
    scene: event.group_id
      ? { type: "group", id: stringId(event.group_id) }
      : null,
  };
}

export function normalizeOneBotEvent(event) {
  if (event.post_type === "message") return normalizeOneBotMessage(event);
  if (event.post_type === "notice") return normalizeOneBotNotice(event);
  if (event.post_type === "request") return normalizeOneBotRequest(event);
  return {
    id: `${event.post_type}-${event.time}`,
    type: event.post_type,
    raw: event,
    timestamp: event.time ?? Math.floor(Date.now() / 1000),
  };
}
