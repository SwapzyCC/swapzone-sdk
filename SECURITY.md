# Security policy

## Reporting a vulnerability in this SDK

Please **do not open a public issue**. Report it privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and the impact you expect. We aim to acknowledge reports within a few working days.

This policy covers the SDK's code only. Report problems with the Swapzone service or API itself to Swapzone: https://swapzone.io

## Supported versions

Only the latest release receives fixes.

## Using the SDK safely

- **Keep your API key on the server.**
  - Load it from the environment or a secret manager.
  - Never commit it.
  - Never send it to a browser or a mobile app.
  - The SDK sends it only in the `x-api-key` header.
- If a key leaks, ask Swapzone to rotate it straight away.
- Validate user-supplied addresses yourself before creating an order.
- Set `refundAddress` on every order.
- Treat a `SwapzoneAPIError` from `exchange.create()` as "no order": Swapzone reports refusals with HTTP 200, and the SDK turns them into errors so they cannot pass as success.
