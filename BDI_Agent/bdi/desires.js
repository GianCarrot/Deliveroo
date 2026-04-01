export const desires = {
    pickParcel: beliefs => beliefs.parcels.length > 0,
    deliverParcel: beliefs => beliefs.me.carrying > 0
};