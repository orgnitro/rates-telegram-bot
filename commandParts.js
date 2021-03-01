const regex = /^\/([^@\s]+)@?(?:(\S+)|)\s?([\s\S]+)?$/i;

module.exports = commandParts = async (ctx, next) => {
  const {
    message: { text = "" },
  } = ctx;
  const parts = regex.exec(text);
  if (!parts) return next();
  const command = {
    text,
    command: parts[1],
    bot: parts[2],
    args: parts[3],
    get splitArgs() {
      return !parts[3] ? [] : parts[3].split(/\s+/).filter((arg) => arg.length);
    },
  };
  ctx.state.command = command;
  return next();
};