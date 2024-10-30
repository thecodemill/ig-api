import LightstreamerClientNode from 'lightstreamer-client-node';
const { LightstreamerClient, Subscription } = LightstreamerClientNode;

export const HOST = 'https://api.ig.com';

export const HOST_DEMO = 'https://demo-api.ig.com';

export default class IG {
  constructor(apiKey, identifier, password, demo = true) {
    this.apiKey = apiKey;
    this.identifier = identifier;
    this.password = password;
    this.demo = demo;
  }

  get host() {
    return this.demo ? HOST_DEMO : HOST;
  }

  get baseUri() {
    return `${this.host}/gateway/deal`;
  }

  get headers() {
    return {
      'Content-Type': 'application/json; charset=UTF-8',
      Accept: 'application/json; charset=UTF-8',
      'X-IG-API-KEY': this.apiKey,
    }
  }

  authRemaining() {
    return this.oauth?.expires ? this.oauth.expires.getTime() - new Date().getTime() : false;
  }

  async authenticate() {
    const authRemaining = this.authRemaining();

    // If remaining auth time is expired and outside 10 min refresh window (5 mins in practice), login from scratch
    if (authRemaining === false || authRemaining <= -(5 * 60 * 1000)) {
      return this.login();
    }

    // If remaining auth time is expired, but within the refresh window, attempt to refresh
    else if (authRemaining <= 0) {
      return this.refresh();
    }
  }

  async validAuthHeaders(authenticate = true) {
    if (authenticate) {
      await this.authenticate();
    }

    return {
      Authorization: `${this.oauth?.tokenType} ${this.oauth?.accessToken}`,
      'IG-ACCOUNT-ID': this.accountId,
    };
  }

  async request(version, method, url, payload, headers, auth = true) {
    const fetchUrl = new URL(`${this.baseUri}${url}`);
    const fetchOptions = {};

    // Method
    fetchOptions.method = method.toUpperCase();

    // Headers
    fetchOptions.headers = {
      ...this.headers,
      ...headers,
      Version: version,
    };

    // Merge auth headers if applicable
    if (auth) {
      fetchOptions.headers = {
        ...fetchOptions.headers,
        ...(await this.validAuthHeaders()),
      };
    }

    // Payload
    if (fetchOptions.method === 'GET') {
      Object.entries(payload || {}).forEach(([key, value]) => {
        fetchUrl.searchParams.append(key, value);
      });
    } else {
      fetchOptions.body = typeof payload === 'object' && payload !== null ? JSON.stringify(payload) : payload;
    }

    // Fix: IG doesn't support DELETE, so fake it
    if (fetchOptions.method === 'DELETE') {
      fetchOptions.method = 'POST';
      fetchOptions.headers._method = 'DELETE';
    }

    return fetch(fetchUrl, fetchOptions);
  }

  parseOauthToken(oauthToken) {
    return {
      accessToken: oauthToken.access_token,
      refreshToken: oauthToken.refresh_token,
      tokenType: oauthToken.token_type,
      expires: new Date(new Date().getTime() + (parseInt(oauthToken.expires_in) * 1000)),
    };
  }

  async login() {
    this.oauth = undefined;

    const res = await this.request(3, 'POST', '/session', {
      identifier: this.identifier,
      password: this.password,
    }, {}, false);

    const { clientId, accountId, timezoneOffset, lightstreamerEndpoint, oauthToken } = await res.json();

    this.clientId = clientId;
    this.accountId = accountId;
    this.timezoneOffset = timezoneOffset;
    this.lightstreamerEndpoint = lightstreamerEndpoint;
    this.oauth = this.parseOauthToken(oauthToken);

    return this;
  }

  async refresh(loginOnError = true) {
    const authHeaders = { ...(await this.validAuthHeaders(false)) };

    const res = await this.request(1, 'POST', '/session/refresh-token', {
      refresh_token: this.oauth.refreshToken,
    }, authHeaders, false);

    if (!res.ok && loginOnError) {
      return this.login();
    }

    const oauthToken = await res.json();

    this.oauth = this.parseOauthToken(oauthToken);

    return this;
  }

  async streamer(callbacks = {}) {
    await this.authenticate();

    const streamer = new LightstreamerClient(this.lightstreamerEndpoint);

    // Grab security tokens (required when connecting with Oauth)
    const res = await this.request(1, 'GET', '/session', { fetchSessionTokens: 'true' });
    const cst = res.headers.get('cst');
    const securityToken = res.headers.get('x-security-token');

    streamer.connectionDetails.setUser(this.accountId);
    streamer.connectionDetails.setPassword(`CST-${cst}|XST-${securityToken}`);

    const {
      serverError: serverErrorCallback,
      listenStart: listenStartCallback,
      statusChange: statusChangeCallback,
    } = callbacks;

    if (serverErrorCallback) {
      streamer.addListener({
        onServerError: (code, message) => serverErrorCallback(code, message),
      });
    }

    if (listenStartCallback) {
      streamer.addListener({
        onListenStart: () => listenStartCallback(),
      });
    }

    if (statusChangeCallback) {
      streamer.addListener({
        onStatusChange: (status) => statusChangeCallback(status),
      });
    }

    streamer.connect();

    return streamer;
  }

  stream(streamer, method, items = [], fields = [], callbacks = {}) {
    const {
      subscription: subscriptionCallback,
      unsubscription: unsubscriptionCallback,
      subscriptionError: subscriptionErrorCallback,
      itemUpdate: itemUpdateCallback,
    } = callbacks;

    const subscription = new Subscription(method, items, fields);

    if (subscriptionCallback) {
      subscription.addListener({
        onSubscription: () => subscriptionCallback(),
      });
    }

    if (unsubscriptionCallback) {
      subscription.addListener({
        onUnsubscription: () => unsubscriptionCallback(),
      });
    }

    if (subscriptionErrorCallback) {
      subscription.addListener({
        onSubscriptionError: (code, message) => subscriptionErrorCallback(code, message),
      });
    }

    if (itemUpdateCallback) {
      subscription.addListener({
        onItemUpdate: (updateInfo) => {
          const name = updateInfo.getItemName().split(':').pop();
          const data = Object.fromEntries(fields.map((key) => [key, JSON.parse(updateInfo.getValue(key))]));
          itemUpdateCallback(name, data, updateInfo);
        },
      });
    }

    streamer.subscribe(subscription);
  }
}
