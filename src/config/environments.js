const ENVIRONMENTS = [
  {
    key: "prod",
    label: "PROD",
    baseUrl: "https://admin.keynua.com",
    usernameEnv: "KEYNUA_PROD_USERNAME",
	passwordEnv: "KEYNUA_PROD_PASSWORD"
  },
  {
    key: "stg",
    label: "STG",
    baseUrl: "https://admin.stg.keynua.com",
    usernameEnv: "KEYNUA_STG_USERNAME",
    passwordEnv: "KEYNUA_STG_PASSWORD"
  }
];

module.exports = ENVIRONMENTS;