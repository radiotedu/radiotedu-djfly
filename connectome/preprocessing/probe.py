"""Verify authenticated access and dataset identity without printing request details."""

import json
import os
import sys

from build import DEFAULT_CONFIG, connect, read_json

stage = "initializing-client"


def main():
    global stage
    config = read_json(DEFAULT_CONFIG)
    client = connect(config)
    if client.dataset != "male-cns:v1.0":
        raise ValueError("Dataset mismatch")
    stage = "querying-dataset-metadata"
    identity = client.djfly_identity
    stage = "counting-neurons"
    summary = client.fetch_custom("MATCH (n:Neuron) RETURN count(n) AS neurons")
    print(json.dumps({"ok": True, "server": config["server"], "dataset": client.dataset,
                      "serverIdentity": identity, "neuronCount": int(summary.iloc[0]["neurons"])}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        response = getattr(error, "response", None)
        detail = ""
        if response is not None:
            try:
                body = response.json()
                detail = str(body.get("error", body.get("message", "")))
            except (ValueError, AttributeError):
                detail = "Server returned a non-JSON error response."
        secret = os.environ.get("NEUPRINT_TOKEN")
        if secret:
            detail = detail.replace(secret, "[REDACTED]")
        print(json.dumps({"ok": False, "stage": stage,
                          "errorType": type(error).__name__,
                          "httpStatus": getattr(response, "status_code", None),
                          "detail": detail[:500]}))
        sys.exit(2)
