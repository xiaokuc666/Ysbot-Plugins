import { OneBotActionError } from "./errors.js";

export class ActionDispatcher {
  constructor({ wsClient, httpClient }) {
    this.wsClient = wsClient;
    this.httpClient = httpClient;
  }

  async send(action, params) {
    const errors = [];
    if (this.wsClient?.connected) {
      try {
        return await this.wsClient.send(action, params);
      } catch (error) {
        errors.push(error);
      }
    }
    if (this.httpClient) {
      try {
        return await this.httpClient.send(action, params);
      } catch (error) {
        errors.push(error);
      }
    }
    throw errors[errors.length - 1]
      || new OneBotActionError("CONNECTION_LOST", "No OneBot transport available");
  }
}
