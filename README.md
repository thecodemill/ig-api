# IG API

A barebones IG API wrapper based on fetch() and Lightstreamer.

## Installation

```
npm i ig-api
```

## Usage

```js
import IG from 'ig-api';

const demoMode = true;
const ig = new IG('API_KEY', 'ACCOUNT_IDENTIFIER', 'ACCOUNT_PASSWORD', demoMode);

// Arbitrary Requests
const positionsResponse = await ig.request(2, 'GET', '/positions');
const { positions } = await positionsResponse.json();

const updatePositionResponse = await ig.request(2, 'PUT', `/positions/otc/{DEAL_ID}`, {
  limitLevel: 1.2345,
  stopLevel: 1.3456,
});

// Streaming Prices
// 1. Initialise a streaming client
const streamer = await ig.streamer({
  serverError: (code, message) => {
    console.error('Server error', code, message);
  },
  listenStart: () => {
    console.log('Streamer listening');
  },
  statusChange: (status) => {
    if (status === 'CONNECTED:WS-STREAMING') {
      console.log('Streamer connected');
    }
  },
}

// 2. Subscribe to price updates stream
ig.stream(streamer, 'MERGE', ['MARKET:CS.D.EURUSD.TODAY.IP'], ['BID', 'OFFER'], {
  subscriptionError: (code, message) => {
    console.error('Subscription error', code, message);
  },
  itemUpdate: (name, data) => {
    const { BID, OFFER } = data;
    console.log('Price Changed', name, BID, OFFER);
  },
});
```
