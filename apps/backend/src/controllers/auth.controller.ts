import type { RequestHandler } from "express";
import type { AuthService } from "../services/auth.service.js";
import { clientActivity, requireAuth } from "../middleware/authenticate.js";
import { loginSchema, parse, registerSchema } from "../validators/request.js";

export function createAuthController(service: AuthService) {
  const register: RequestHandler = async (req, res) => {
    const input = parse(registerSchema, req.body);
    res.status(201).json({ success: true, data: await service.register(input, clientActivity(req)) });
  };
  const login: RequestHandler = async (req, res) => {
    const input = parse(loginSchema, req.body);
    res.json({ success: true, data: await service.login(input, clientActivity(req)) });
  };
  const me: RequestHandler = (req, res) => {
    res.json({ success: true, data: requireAuth(req).user });
  };
  const activity: RequestHandler = async (req, res) => {
    res.json({ success: true, data: await service.state.getActivity(requireAuth(req).userId) });
  };
  const logout: RequestHandler = async (req, res) => {
    const identity = requireAuth(req);
    await service.state.revoke(identity.tokenId, identity.expiresAt);
    res.sendStatus(204);
  };
  return { register, login, me, activity, logout };
}
