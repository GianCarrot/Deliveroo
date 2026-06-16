import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk'

/**
 * Creates a socket connection to the Deliveroo game server with automatic reconnection.
 * @param {string} [host] - server URL (falls back to process.env.HOST)
 * @param {string} [token] - authentication token (falls back to process.env.TOKEN)
 * @returns {object} connected Deliveroo socket
 */
export function connect(host, token) {
    const h = host || process.env.HOST;
    const t = token || process.env.TOKEN;

    const socket = DjsConnect(h, t, 
        {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,});

    return socket;
}