export type Location = {
  readonly file: string;
  readonly line: number | null;
  readonly column: number | null;
};

export type Comparison = {
  readonly expected: string;
  readonly actual: string;
};

export type Diagnostic = {
  readonly code: string;
  readonly message: string;
  readonly location: Location | null;
  readonly comparison?: Comparison;
  readonly detail?: string;
  readonly hint?: string;
};
