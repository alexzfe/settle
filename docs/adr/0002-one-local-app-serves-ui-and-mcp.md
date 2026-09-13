---
status: accepted
---

# One long-running local app serves both the web UI and MCP over HTTP

The platform is a single program that runs in the background on the user's machine. It owns the database, serves the web UI on localhost, and exposes the MCP server over HTTP on localhost, and the Agent connects to it there. We chose this over the more usual stdio MCP server that the Agent launches for each session because that setup needs a separate web server process, puts two writers on one database, and makes it hard for the UI to see the Agent's changes live. The cost is that the user has to start the app before running a Session. It also makes hosting a deployment change rather than a redesign: packaging it as a Docker container is the expected next step, and running it on a server would let claude.ai or ChatGPT connect later.
