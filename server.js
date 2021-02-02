/*
 * This file is part of Web Draw.
 *
 * Web Draw - A little real-time online drawing program.
 * Copyright (C) 2020-2021 martendo7
 *
 * Web Draw is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Web Draw is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Web Draw.  If not, see <https://www.gnu.org/licenses/>.
 */

"use strict";

const WebSocket = require("ws");
const msgpack   = require("msgpack-lite");

const wss = new WebSocket.Server({ port: process.env.PORT || 3000 });

const sessions = new Map();
const clients = new Map();

function createUniqueId(map, len = 4, chars = "bcdfghjklmnpqrstvwxyz0123456789") {
  var id;
  do {
    id = "";
    for (var i = 0; i < len; i++) {
      id += chars[(Math.random() * chars.length) | 0];
    }
  } while (map.has(id));
  return id;
}

class Session {
  constructor(id) {
    this.id = id;
    this.clients = new Map();
    this.password = null;
    sessions.set(this.id, this);
    console.log(`Create session ${this.id} - ${sessions.size} sessions open`);
  }
  
  join(client, restore = false) {
    if (client.session) {
      console.error("Client already in session!");
    }
    this.clients.set(client.id, client);
    client.session = this;
    client.send({
      type: "session-joined",
      id: this.id,
      total: this.clients.size,
      clients: [...this.clients.values()].map((c) => {
        return {
          id: c.id,
          name: c.name
        };
      }),
      password: this.password,
      restore: restore
    });
    client.broadcast({
      type: "user-joined",
      total: this.clients.size,
      client: {
        id: client.id,
        name: client.name
      }
    });
    console.log(`Client ${client.id} joined session ${this.id} - ${this.clients.size} clients in session`);
    if (this.clients.size !== 1) {
      [...this.clients.values()][0].send({
        type: "request-canvas",
        clientId: client.id
      });
    }
  }
  
  leave(client) {
    if (client.session !== this) {
      console.error("Client not in this session!");
    }
    this.clients.delete(client.id);
    client.broadcast({
      type: "user-left",
      total: this.clients.size,
      client: {
        id: client.id,
        name: client.name
      }
    });
    client.session = null;
    console.log(`Client ${client.id} left session ${this.id} - ${this.clients.size} clients in session`);
    
    if (this.clients.size === 0) {
      sessions.delete(this.id);
      console.log(`Delete session ${this.id} - ${sessions.size} sessions open`);
    }
  }
  
  // Send a message to all clients in this session
  broadcast(data) {
    this.clients.forEach((client) => {
      client.send(data);
    });
  }
  
  setPassword(client, password) {
    this.password = password;
    this.broadcast({
      type: "password-set",
      password: this.password,
      clientId: client.id
    });
    console.log(`Set session ${this.id} password ${password}`);
  }
}

class Client {
  constructor(connection, id) {
    this.connection = connection;
    this.id = id;
    this.name = null;
    this.session = null;
    this.isAlive = true;
    this.receiveMouse = true;
    clients.set(this.id, this);
  }
  
  // Send a message to all other clients in session except this client
  broadcast(data, callback = null) {
    if (!this.session) return;
    
    this.session.clients.forEach((client) => {
      if (client !== this) {
        if (typeof callback === "function") {
          if (!callback(client)) return;
        }
        client.send(data);
      }
    });
  }
  
  // Send a message to this client
  send(data) {
    const msg = msgpack.encode(data);
    this.connection.send(msg, { binary: true }, (error) => {
      if (error) console.error("Message send failed", msg, error);
    });
  }
  
  ping() {
    if (!this.isAlive) return this.connection.terminate();
    this.isAlive = false;
    this.connection.ping(() => {
      this.pingTime = Date.now();
    });
  }
}

function joinSession(client, id, pass = null, restore) {
  const session = sessions.get(id);
  if (session.password) {
    if (pass) {
      checkSessionPassword(client, id, pass);
    } else {
      client.send({
        type: "enter-password",
        id: id
      });
    }
  } else {
    session.join(client, restore);
  }
}
function createSession(client, id, pass = null, restore) {
  const session = new Session(id);
  joinSession(client, id, pass, restore);
  session.setPassword(client, pass);
  return session;
}
function checkSessionPassword(client, id, password) {
  const session = sessions.get(id);
  if (!session) {
    client.send({
      type: "session-no-exist",
      id: id
    });
  } else if (password === session.password) {
    session.join(client);
  } else {
    client.send({
      type: "wrong-password",
      password: password,
      id: id
    });
  }
}

wss.on("connection", (socket) => {
  const client = new Client(socket, createUniqueId(clients));
  client.send({
    type: "connection-established",
    id: client.id
  });
  console.log(`Client connect ${client.id} - ${clients.size} clients connected`);
  socket.on("pong", () => {
    const latency = Date.now() - client.pingTime;
    client.send({
      type: "latency",
      latency: latency
    });
    client.isAlive = true;
  });
  const pingClient = setInterval(() => client.ping(), 10000);
  setTimeout(() => client.ping(), 1000);
  socket.on("error", (error) => {
    console.error(error);
  });
  socket.on("close", (code) => {
    clients.delete(client.id);
    console.log(`Client disconnect ${client.id} - ${code} - ${clients.size} clients connected`);
    clearInterval(pingClient);
    const session = client.session;
    if (session) session.leave(client);
    socket.close();
  });
  socket.on("message", (msg) => {
    const data = msgpack.decode(msg);
    switch (data.type) {
      case "fill":
      case "clear":
      case "clear-blank":
      case "import-picture":
      case "open-canvas":
      case "resize-canvas":
      case "move-history":
      case "toggle-action":
      case "start-stroke":
      case "add-stroke":
      case "end-stroke":
      case "create-selection":
      case "remove-selection":
      case "selection-update":
      case "selection-copy":
      case "selection-cut":
      case "selection-paste":
      case "selection-clear":
      case "line":
      case "commit-line":
      case "rect":
      case "commit-rect":
      case "ellipse":
      case "commit-ellipse": {
        client.broadcast(data);
        break;
      }
      case "mouse-move": {
        client.broadcast(data, (c) => c.receiveMouse);
        break;
      }
      case "chat-message": {
        const timestamp = Date.now();
        if (data.message.slice(0, 3) === "to:") {
          const idList = data.message.split(" ")[0].slice(3);
          var ids = idList.split(",");
          // Remove recipients who are not in client's session
          ids = ids.filter((id) => client.session.clients.has(id));
          // Sending to nobody, end
          if (ids.length === 0) break;
          
          // Show sender the message
          ids.push(client.id);
          // Remove duplicate recipients
          ids = [...new Set(ids)];
          ids.forEach((id) => {
            client.session.clients.get(id).send({
              type: "chat-message",
              message: data.message.slice(3 + idList.length + 1),
              clientId: client.id,
              priv: ids,
              timestamp: timestamp
            });
          });
        } else {
          data.timestamp = timestamp;
          client.session.broadcast(data);
        }
        break;
      }
      case "user-name": {
        client.name = data.name;
        client.session.broadcast(data);
        break;
      }
      case "response-canvas": {
        client.session.clients.get(data.clientId).send(data);
        break;
      }
      case "create-session": {
        var id = data.id;
        if (id === "") {
          id = createUniqueId(sessions);
        }
        if (sessions.has(id)) {
          client.send({
            type: "session-already-exist",
            id: id
          });
        } else {
          createSession(client, id);
        }
        break;
      }
      case "join-session": {
        if (sessions.has(data.id)) {
          joinSession(client, data.id);
        } else {
          client.send({
            type: "session-no-exist",
            id: data.id
          });
        }
        break;
      }
      case "enter-password": {
        checkSessionPassword(client, data.id, data.password);
        break;
      }
      case "leave-session": {
        const session = client.session;
        if (session) session.leave(client);
        break;
      }
      case "url-session": {
        if (sessions.has(data.id)) {
          joinSession(client, data.id, data.password);
        } else {
          createSession(client, data.id, data.password);
        }
        break;
      }
      case "reconnect": {
        if (!clients.has(data.client.id)) {
          clients.delete(client.id);
          client.id = data.client.id;
          clients.set(client.id, client);
        }
        client.name = data.client.name;
        client.send({
          type: "connection-established",
          id: client.id
        });
        
        if (!sessions.has(data.session.id)) {
          if (client.session) sessions.delete(client.session.id);
          client.session = createSession(client, data.session.id, data.session.password, true);
          sessions.set(client.session.id, client.session);
        } else {
          joinSession(client, data.session.id, data.session.password);
        }
        client.session.broadcast({
          type: "user-name",
          name: client.name,
          clientId: client.id
        });
        
        break;
      }
      case "session-id": {
        if (sessions.has(data.id)) {
          client.send({
            type: "session-has-id",
            id: data.id
          });
        } else {
          console.log(`Change session ${client.session.id} to ${data.id}`);
          sessions.delete(client.session.id);
          client.session.id = data.id;
          sessions.set(client.session.id, client.session);
          client.session.broadcast({
            type: "session-id-changed",
            id: data.id,
            clientId: client.id
          });
        }
        break;
      }
      case "session-password": {
        client.session.setPassword(client, data.password);
        break;
      }
      case "send-mouse": {
        client.broadcast({
          type: "display-cursor",
          clientId: client.id,
          value: data.value
        });
        break;
      }
      case "receive-mouse": {
        client.receiveMouse = data.value;
        break;
      }
      default: {
        console.error(`Unknown message ${data.type}!`, data);
        break;
      }
    }
  });
});
