import { toQqActionError } from "./errors.js";

export class QqApi {
  constructor({ registry, protocolPluginId = "protocol-onebot" }) {
    this.registry = registry;
    this.protocolPluginId = protocolPluginId;
  }

  async invoke(action, params, context) {
    try {
      return await this.registry.invoke(this.protocolPluginId, {
        action,
        params,
        context,
      });
    } catch (error) {
      throw toQqActionError(error, action);
    }
  }
}
