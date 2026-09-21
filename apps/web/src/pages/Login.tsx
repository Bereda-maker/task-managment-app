import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "../auth/AuthContext";
import FormField from "../components/FormField";
import { ApiError } from "../lib/api";
import { LoginSchema, type LoginValues } from "../lib/schemas";

export default function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof LoginSchema>, unknown, LoginValues>({ resolver: zodResolver(LoginSchema) });

  if (status === "authenticated") return <Navigate to={from} replace />;

  const submit = handleSubmit(async (values) => {
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (e) {
      // The fetch wrapper already showed a toast; just make sure unexpected errors aren't swallowed.
      if (!(e instanceof ApiError)) throw e;
    }
  });

  return (
    <div className="auth-page">
      <h1>Log in</h1>
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormField id="login-email" label="Email" error={errors.email?.message}>
          {(aria) => <input type="email" autoComplete="email" {...aria} {...register("email")} />}
        </FormField>
        <FormField id="login-password" label="Password" error={errors.password?.message}>
          {(aria) => <input type="password" autoComplete="current-password" {...aria} {...register("password")} />}
        </FormField>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          Log in
        </button>
      </form>
      <p className="auth-switch">
        New here? <Link to="/register">Create an account</Link>
      </p>
    </div>
  );
}
