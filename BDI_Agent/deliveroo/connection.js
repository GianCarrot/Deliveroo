import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk'

export function connect() {
    const host = process.env.HOST;
    const TOKEN = process.env.TOKEN;

    const socket = DjsConnect(host, TOKEN);

    return socket;
}