import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk'

export function connect() {
    const host = process.env.HOST;
    const token = proccess.env.TOKEN;

    const socket = DjsConnect(host, token);

    return socket;
}