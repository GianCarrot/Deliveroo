import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk'

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