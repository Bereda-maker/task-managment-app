import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "../auth/AuthContext";
import FormField from "../components/FormField";
import { ApiError } from "../lib/api";
import { RegisterSchema, type RegisterValues } from "../lib/schemas";

export default function RegisterPage() {
  const { status, register: signUp } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof RegisterSchema>, unknown, RegisterValues>({ resolver: zodResolver(RegisterSchema) });

  if (status === "authenticated") return <Navigate to="/" replace />;

  const submit = handleSubmit(async (values) => {
    try {
      await signUp(values);
      navigate("/", { replace: true });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
  });

  return (
    <div className="auth-page">
      <h1>Create your account</h1>
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormField id="register-name" label="Name" hint="Teammates see this on tasks assigned to you." error={errors.name?.message}>
          {(aria) => <input type="text" autoComplete="name" {...aria} {...register("name")} />}
        </FormField>
        <FormField id="register-email" label="Email" error={errors.email?.message}>
          {(aria) => <input type="email" autoComplete="email" {...aria} {...register("email")} />}
        </FormField>
        <FormField id="register-password" label="Password" hint="At least 8 characters." error={errors.password?.message}>
          {(aria) => <input type="password" autoComplete="new-password" {...aria} {...register("password")} />}
        </FormField>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          Create account
        </button>
      </form>
      <p className="auth-switch">
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
