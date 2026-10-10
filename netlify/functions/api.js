// Netlify Function that exposes the existing Node backend (backend/server.js) as a
// serverless handler, so the storefront's API runs on the SAME Netlify domain as
// the frontend. This removes the need for a separate Render host and any CORS setup.
//
// backend/server.js exports its raw (req, res) handler; serverless-http adapts a
// Netlify event into that Node http handler.
const serverless = require("serverless-http");
const { handler } = require("../../backend/server");

const serverlessHandler = serverless(handler);

exports.handler = async (event, context) => {
  const response = await serverlessHandler(event, context);
  return response;
};
