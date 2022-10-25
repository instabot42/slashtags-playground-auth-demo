import jrpcLite from 'jsonrpc-lite';
import JsonRPC from 'simple-jsonrpc-js';
import { WebSocketServer } from 'ws'
import fs from 'fs'

const port = 9002

import SDK, { SlashURL } from '@synonymdev/slashtags-sdk';
import { Server } from '@synonymdev/slashtags-auth';

/** START SLASHTAGS AUTH SETUP **/

let saved
try { saved = fs.readFileSync('./storage/primaryKey') } catch { }

const sdk = new SDK({ storage: './storage', primaryKey: saved })

if (!saved) fs.writeFileSync('./storage/primaryKey', sdk.primaryKey)

// Get the default slashtag
const slashtag = sdk.slashtag()

// Set profile if not already saved
const publicDrive = slashtag.drivestore.get()
await publicDrive.ready()
const exists = await publicDrive.get('/profile.json')
if (!exists) await publicDrive.put('/profile.json', Buffer.from(JSON.stringify({
  name: 'SlashAuth Demo',
  image:
    "data:image/svg+xml,%3Csvg width='48' height='48' viewBox='0 0 48 48' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M26.5259 0.135322C39.7212 1.52962 49.259 13.3508 47.8647 26.5259C46.4704 39.7212 34.6492 49.259 21.4741 47.8647C8.27882 46.4704 -1.25897 34.6492 0.135322 21.4741C1.52962 8.27882 13.3508 -1.25897 26.5259 0.135322ZM26.0005 5.1467C15.6342 4.03531 6.23789 11.6332 5.1467 21.9995C4.03531 32.3658 11.6332 41.7621 21.9995 42.8533C32.3658 43.9647 41.7621 36.3668 42.8533 26.0005C43.9647 15.6342 36.3668 6.23789 26.0005 5.1467Z' fill='url(%23paint0_linear_3541_13934)'/%3E%3Cdefs%3E%3ClinearGradient id='paint0_linear_3541_13934' x1='41.1' y1='40.35' x2='8.1' y2='7.35' gradientUnits='userSpaceOnUse'%3E%3Cstop stop-color='%23DB00FF'/%3E%3Cstop offset='1' stop-color='%23FE0099'/%3E%3C/linearGradient%3E%3C/defs%3E%3C/svg%3E%0A",
  bio: 'Web of trust for all',
})))

const server = new Server(slashtag, {
  onauthz: (token, remote) => {
    if (!isValidUser(remote)) return { status: "error", message: "sign up first!" }

    const url = SlashURL.format(remote)

    // Check that token is valid, and remote isn't blocked
    const valid = validateToken(token, url)
    if (valid) {
      console.log('Got valid session', token, "from:", url);
      return { status: "ok" }
    }
    console.log('Got invalid session', token, "from:", url);
    return { status: "error", message: "invalid token" }
  },
  onmagiclink: (remote) => {
    const user = SlashURL.encode(remote)
    console.log("Got magic link request, from:", user)
    return {
      url: `https://www.synonym.to/playground/accounts?user=` + user,
      validUntil: Number(new Date() + 1000 * 60 * 20)
    }
  }
})

// Listen on server's Slashtag key through DHT connections
await slashtag.listen()

/** END OF SLASHTAGS AUTH SETUP **/

/** YOUR NORMAL SERVER LOGIC **/
const sessions = new Map();

function isValidUser(_) { return true }

function validateToken(token, user) {
  const socket = sessions.get(token);
  if (!socket) return false
  socket.send(
    jrpcLite
      .notification('userAuthenticated', { user })
      .serialize(),
  );
  return true
}

const wss = new WebSocketServer({ port, host: '0.0.0.0' });

wss.on('connection', (socket) => {
  console.log('connection seen')
  const jrpc = new JsonRPC();

  socket.onmessage = (event) => jrpc.messageHandler(event.data);
  jrpc.toStream = (msg) => socket.send(msg);

  jrpc.on('clientID', ['clientID'], (clientID) => {
    const saved = sessions.get(clientID);
    if (saved === socket) return
    saved?.close();

    sessions.set(clientID, socket);
    console.log('Client connected: ', clientID);
    console.log('Sessions: ', sessions.size);

    jrpc.notification('slashauthUrl', {
      url: server.formatURL(clientID)
    });
  });
});

console.log(`Server is now listenng on port ${port}`);
