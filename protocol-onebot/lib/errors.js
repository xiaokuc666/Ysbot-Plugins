export class OneBotActionError extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = "OneBotActionError";
    this.code = code;
    this.retcode = options.retcode;
    this.wording = options.wording;
    this.echo = options.echo;
  }
}
