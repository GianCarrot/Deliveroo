import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk'

export function connect() {
    const host = process.env.HOST;
    const TOKEN = process.env.TOKEN;

    const socket = DjsConnect(host, TOKEN, 
        {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,});

    return socket;
}