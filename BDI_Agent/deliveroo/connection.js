import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk'

export function connect() {
    const host = process.env.HOST;
    
    const socket = DjsConnect(host);

    return socket;
}