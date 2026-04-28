// Form field primitives. Replaces the inline form input styles repeated
// across pair-manager, watchlist-editor, threshold-editor, login.
//
// Three primitives:
//   <FieldWrapper label hint> — vertical label + child input + optional hint
//   <TextField>               — styled <input>
//   <SelectField>             — styled <select>
//   <Checkbox label>          — styled checkbox + label

import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';

// Shared input styling — used by TextField, SelectField, and any custom
// inputs that want the same look. Tailwind doesn't compose these via a
// utility class, but the constant is stable across our 4–5 input sites.
const INPUT_BASE =
  'w-full border border-gray-300 rounded-sm px-3 py-2 text-sm bg-white text-night ' +
  'placeholder:text-gray-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-royal/30 focus:border-royal ' +
  'disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed ' +
  'transition-colors duration-150';

interface FieldWrapperProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function FieldWrapper({ label, hint, htmlFor, children, className = '' }: FieldWrapperProps) {
  return (
    <label htmlFor={htmlFor} className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export function TextField(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input {...rest} className={`${INPUT_BASE} ${className}`} />;
}

export function SelectField(
  props: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode },
) {
  const { className = '', children, ...rest } = props;
  return (
    <select {...rest} className={`${INPUT_BASE} ${className}`}>
      {children}
    </select>
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export function Checkbox({ label, className = '', ...rest }: CheckboxProps) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-700">
      <input
        type="checkbox"
        {...rest}
        className={`rounded-sm border-gray-300 text-royal focus:ring-2 focus:ring-royal/30 ${className}`}
      />
      <span>{label}</span>
    </label>
  );
}
