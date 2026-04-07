import { gql } from './graphql';

export interface Transaction {
  id: string;
  mutation: string;
  variables: Record<string, unknown>;
  onSuccess?: (result: unknown) => void;
  onError?: (err: Error) => void;
  retryCount: number;
  maxRetries: number;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000];

/**
 * Queues GraphQL mutations and processes them serially.
 * On permanent failure, calls onError so the caller can roll back optimistic changes.
 */
export class TransactionQueue {
  private queue: Transaction[] = [];
  private processing = false;

  enqueue(
    mutation: string,
    variables: Record<string, unknown>,
    callbacks?: Pick<Transaction, 'onSuccess' | 'onError'>,
  ): string {
    const id = crypto.randomUUID();
    this.queue.push({
      id,
      maxRetries: MAX_RETRIES,
      mutation,
      onError: callbacks?.onError,
      onSuccess: callbacks?.onSuccess,
      retryCount: 0,
      variables,
    });
    this.processNext();
    return id;
  }

  private async processNext() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const tx = this.queue[0];
    try {
      const result = await gql(tx.mutation, tx.variables);
      if (result.errors?.length) {
        const firstError = result.errors[0] as { message: string };
        throw Object.assign(new Error(firstError.message), {
          permanent: true,
        });
      }
      this.queue.shift();
      tx.onSuccess?.(result.data);
    } catch (err) {
      const error = err as Error & { permanent?: boolean };
      const isPermanent =
        error.permanent ||
        tx.retryCount >= tx.maxRetries;

      if (isPermanent) {
        this.queue.shift();
        tx.onError?.(error);
      } else {
        tx.retryCount++;
        const delay = RETRY_DELAYS_MS[tx.retryCount - 1] ?? 10_000;
        await sleep(delay);
      }
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        this.processNext();
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
