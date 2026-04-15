import {
  type AuthBearerBootstrapResult,
  AuthBootstrapInput,
  AuthCreatePairingCredentialInput,
  AuthRevokeClientSessionInput,
  AuthRevokePairingLinkInput,
  type AuthWebSocketTokenResult,
} from "@t3tools/contracts";
import { DateTime, Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  type AuthenticatedSession,
  AuthError,
  ServerAuth,
  type ServerAuthShape,
} from "./Services/ServerAuth.ts";
import { SessionCredentialService } from "./Services/SessionCredentialService.ts";
import { deriveAuthClientMetadata } from "./utils.ts";

type AuthRouteEffect<R = never> = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  AuthError,
  HttpServerRequest.HttpServerRequest | R
>;

export const respondToAuthError = (error: AuthError) =>
  Effect.gen(function* () {
    if ((error.status ?? 500) >= 500) {
      yield* Effect.logError("auth route failed", {
        message: error.message,
        cause: error.cause,
      });
    }
    return HttpServerResponse.jsonUnsafe(
      {
        error: error.message,
      },
      { status: error.status ?? 500 },
    );
  });

const withAuthErrorResponse = <R>(effect: AuthRouteEffect<R>) =>
  effect.pipe(Effect.catchTag("AuthError", respondToAuthError));

const authSessionHandler: AuthRouteEffect<ServerAuth> = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* Effect.service(ServerAuth);
  const session = yield* serverAuth.getSessionState(request);
  return HttpServerResponse.jsonUnsafe(session, { status: 200 });
});

export const authSessionRouteLayer = HttpRouter.add("GET", "/api/auth/session", authSessionHandler);

const PairingCredentialRequestHeaders = Schema.Struct({
  "content-length": Schema.optionalKey(Schema.String),
  "content-type": Schema.optionalKey(Schema.String),
  "transfer-encoding": Schema.optionalKey(Schema.String),
});

function hasRequestBody(headers: typeof PairingCredentialRequestHeaders.Type) {
  const contentLengthHeader = headers["content-length"];
  if (typeof contentLengthHeader === "string") {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength)) {
      return contentLength > 0;
    }
  }
  return typeof headers["transfer-encoding"] === "string";
}

export const authBootstrapRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/bootstrap",
  withAuthErrorResponse(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const serverAuth = yield* Effect.service(ServerAuth);
      const sessions = yield* Effect.service(SessionCredentialService);
      const payload = yield* HttpServerRequest.schemaBodyJson(AuthBootstrapInput).pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({
              message: "Invalid bootstrap payload.",
              status: 400,
              cause,
            }),
        ),
      );
      const result = yield* serverAuth.exchangeBootstrapCredential(
        payload.credential,
        deriveAuthClientMetadata({ request }),
      );

      return HttpServerResponse.setCookieUnsafe(
        HttpServerResponse.jsonUnsafe(result.response, { status: 200 }),
        sessions.cookieName,
        result.sessionToken,
        {
          expires: DateTime.toDate(result.response.expiresAt),
          httpOnly: true,
          path: "/",
          sameSite: "lax",
        },
      );
    }) satisfies AuthRouteEffect<ServerAuth | SessionCredentialService>,
  ),
);

export const authBearerBootstrapRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/bootstrap/bearer",
  withAuthErrorResponse(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const serverAuth = yield* Effect.service(ServerAuth);
      const payload = yield* HttpServerRequest.schemaBodyJson(AuthBootstrapInput).pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({
              message: "Invalid bootstrap payload.",
              status: 400,
              cause,
            }),
        ),
      );
      const result = yield* serverAuth.exchangeBootstrapCredentialForBearerSession(
        payload.credential,
        deriveAuthClientMetadata({ request }),
      );
      return HttpServerResponse.jsonUnsafe(result satisfies AuthBearerBootstrapResult, {
        status: 200,
      });
    }) satisfies AuthRouteEffect<ServerAuth>,
  ),
);

export const authWebSocketTokenRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/ws-token",
  withAuthErrorResponse(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const serverAuth = yield* Effect.service(ServerAuth);
      const session = yield* serverAuth.authenticateHttpRequest(request);
      const result = yield* serverAuth.issueWebSocketToken(session);
      return HttpServerResponse.jsonUnsafe(result satisfies AuthWebSocketTokenResult, {
        status: 200,
      });
    }) satisfies AuthRouteEffect<ServerAuth>,
  ),
);

export const authPairingCredentialRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/pairing-token",
  withAuthErrorResponse(
    Effect.gen(function* () {
      const serverAuth = yield* Effect.service(ServerAuth);
      const request = yield* HttpServerRequest.HttpServerRequest;
      const session = yield* serverAuth.authenticateHttpRequest(request);
      if (session.role !== "owner") {
        return yield* Effect.fail(
          new AuthError({
            message: "Only owner sessions can create pairing credentials.",
            status: 403,
          }),
        );
      }
      const headers = yield* HttpServerRequest.schemaHeaders(PairingCredentialRequestHeaders).pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({
              message: "Invalid pairing credential request headers.",
              status: 400,
              cause,
            }),
        ),
      );
      const payload = hasRequestBody(headers)
        ? yield* HttpServerRequest.schemaBodyJson(AuthCreatePairingCredentialInput).pipe(
            Effect.mapError(
              (cause) =>
                new AuthError({
                  message: "Invalid pairing credential payload.",
                  status: 400,
                  cause,
                }),
            ),
          )
        : {};
      const result = yield* serverAuth.issuePairingCredential(payload);
      return HttpServerResponse.jsonUnsafe(result, { status: 200 });
    }) satisfies AuthRouteEffect<ServerAuth>,
  ),
);

const authenticateOwnerSession: Effect.Effect<
  {
    readonly serverAuth: ServerAuthShape;
    readonly session: AuthenticatedSession;
  },
  AuthError,
  HttpServerRequest.HttpServerRequest | ServerAuth
> = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* Effect.service(ServerAuth);
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* Effect.fail(
      new AuthError({
        message: "Only owner sessions can manage network access.",
        status: 403,
      }),
    );
  }
  return { serverAuth, session } as const;
});

export const authPairingLinksRouteLayer = HttpRouter.add(
  "GET",
  "/api/auth/pairing-links",
  withAuthErrorResponse(
    Effect.gen(function* () {
      const { serverAuth } = yield* authenticateOwnerSession;
      const pairingLinks = yield* serverAuth.listPairingLinks();
      return HttpServerResponse.jsonUnsafe(pairingLinks, { status: 200 });
    }) satisfies AuthRouteEffect<ServerAuth>,
  ),
);

export const authPairingLinksRevokeRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/pairing-links/revoke",
  withAuthErrorResponse(
    Effect.gen(function* () {
      const { serverAuth } = yield* authenticateOwnerSession;
      const payload = yield* HttpServerRequest.schemaBodyJson(AuthRevokePairingLinkInput).pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({
              message: "Invalid revoke pairing link payload.",
              status: 400,
              cause,
            }),
        ),
      );
      const revoked = yield* serverAuth.revokePairingLink(payload.id);
      return HttpServerResponse.jsonUnsafe({ revoked }, { status: 200 });
    }) satisfies AuthRouteEffect<ServerAuth>,
  ),
);

export const authClientsRouteLayer = HttpRouter.add(
  "GET",
  "/api/auth/clients",
  withAuthErrorResponse(
    Effect.gen(function* () {
      const { serverAuth, session } = yield* authenticateOwnerSession;
      const clients = yield* serverAuth.listClientSessions(session.sessionId);
      return HttpServerResponse.jsonUnsafe(clients, { status: 200 });
    }) satisfies AuthRouteEffect<ServerAuth>,
  ),
);

export const authClientsRevokeRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/clients/revoke",
  withAuthErrorResponse(
    Effect.gen(function* () {
      const { serverAuth, session } = yield* authenticateOwnerSession;
      const payload = yield* HttpServerRequest.schemaBodyJson(AuthRevokeClientSessionInput).pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({
              message: "Invalid revoke client payload.",
              status: 400,
              cause,
            }),
        ),
      );
      const revoked = yield* serverAuth.revokeClientSession(session.sessionId, payload.sessionId);
      return HttpServerResponse.jsonUnsafe({ revoked }, { status: 200 });
    }) satisfies AuthRouteEffect<ServerAuth>,
  ),
);

export const authClientsRevokeOthersRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/clients/revoke-others",
  withAuthErrorResponse(
    Effect.gen(function* () {
      const { serverAuth, session } = yield* authenticateOwnerSession;
      const revokedCount = yield* serverAuth.revokeOtherClientSessions(session.sessionId);
      return HttpServerResponse.jsonUnsafe({ revokedCount }, { status: 200 });
    }) satisfies AuthRouteEffect<ServerAuth>,
  ),
);
