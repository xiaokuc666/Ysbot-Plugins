import test from "node:test";
import assert from "node:assert/strict";
import ActionQqPlugin from "../index.js";
import { ERROR_CODES, QqActionError } from "../lib/errors.js";

function makePlugin({ kickError, members, verifyError }) {
  const plugin = Object.create(ActionQqPlugin.prototype);
  const calls = [];
  plugin.disposed = false;
  plugin.ctx = {};
  plugin.qq = {
    invoke: async (action, params) => {
      calls.push({ action, params });
      if (action === "set_group_kick") {
        if (kickError) throw kickError;
        return { status: "ok", data: {} };
      }
      if (action === "get_group_member_list") {
        if (verifyError) throw verifyError;
        return { status: "ok", data: members };
      }
      return { status: "ok", data: {} };
    },
  };
  plugin.log = { info: () => {} };
  return { plugin, calls };
}

test("kick reports success when protocol failed but member is gone", async () => {
  const kickError = new QqActionError(
    ERROR_CODES.ONEBOT_FAILED,
    "kick member failed: raw-uid",
    { wording: "kick member failed" },
  );
  const { plugin, calls } = makePlugin({
    kickError,
    members: [{ user_id: "another" }],
  });
  let sent;

  await plugin.handleManagerKick({
    body: { groupId: "10001", userId: "20001" },
    sendJson: (status, data) => {
      sent = { status, data };
    },
  });

  assert.equal(sent.status, 200);
  assert.equal(sent.data.ok, true);
  assert.equal(sent.data.recovered, true);
  assert.deepEqual(
    calls.map((call) => call.action),
    ["set_group_kick", "get_group_member_list"],
  );
});

test("kick keeps the protocol error when the member is still present", async () => {
  const kickError = new QqActionError(
    ERROR_CODES.ONEBOT_FAILED,
    "kick member failed: raw-uid",
    { wording: "kick member failed" },
  );
  const { plugin } = makePlugin({
    kickError,
    members: [{ user_id: "20001" }],
  });
  let sent;

  await assert.rejects(
    plugin.handleManagerKick({
      body: { groupId: "10001", userId: "20001" },
      sendJson: (status, data) => {
        sent = { status, data };
      },
    }),
    /kick member failed/,
  );
  assert.equal(sent, undefined);
});

test("kick keeps the protocol error when verification cannot confirm", async () => {
  const kickError = new QqActionError(
    ERROR_CODES.ONEBOT_FAILED,
    "kick member failed: raw-uid",
    { wording: "kick member failed" },
  );
  const { plugin } = makePlugin({
    kickError,
    members: [],
    verifyError: new Error("member list unavailable"),
  });

  await assert.rejects(
    plugin.handleManagerKick({
      body: { groupId: "10001", userId: "20001" },
      sendJson: () => {},
    }),
    /kick member failed/,
  );
});
