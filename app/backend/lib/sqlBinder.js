// A SQL parameter binder: every value goes in as a named :pN parameter, never spliced into the statement.
const binder = () => {
  const parameters = [];
  const bind = (value, type = 'STRING') => {
    const name = `p${parameters.length}`;
    parameters.push({ name, value: String(value), type });
    return `:${name}`;
  };
  return { parameters, bind };
};

module.exports = { binder };
