import { MessageTransport, MessageType, RequestMessage, ResponseMessage } from '../MessageTransport';
import { annotate, deannotate } from '../serialize';

type SubjectResolver<T, R> = (message: RequestMessage<T> | ResponseMessage<R>) => string;

interface Options<T, R> {
  subscriptions: string[];
  publishSubject: string | SubjectResolver<T, R>;
}

export class LocalPubSubTransport<T, R> implements MessageTransport<T, R> {
  private options: Options<T, R>;
  private receiveHandler?: (message: RequestMessage<T> | ResponseMessage<R>) => void;
  private subIds: number[] = [];
  private subjectById = new Map<number, string>();

  constructor(options: Options<T, R>) {
    this.options = options;
    this.subIds = options.subscriptions.map(sub =>
      PubSub.instance.subscribe(sub, (message: RequestMessage<T> | ResponseMessage<R>) => {
        if (this.receiveHandler) {
          this.receiveHandler(message);
        }
      }),
    );
  }

  async send(message: RequestMessage<T> | ResponseMessage<R>): Promise<void> {
    const publishSubject = this.options.publishSubject;

    let subject: string | undefined;
    if (message.t === MessageType.End) {
      subject = this.subjectById.get(message.c);
    } else {
      subject = typeof publishSubject === 'string' ? publishSubject : publishSubject(message);
    }

    if (subject === undefined) {
      throw new Error('Could not get subject');
    }

    if (message.t === MessageType.End) {
      this.subjectById.delete(message.c);
    } else {
      this.subjectById.set(message.c, subject);
    }

    const subCount = PubSub.instance.publish(subject, message);
    if (subCount === 0) {
      throw new Error(`No subscribers for subject: ${subject}`);
    }

    return undefined;
  }
  onReceive(receive: (message: RequestMessage<T> | ResponseMessage<R>) => void): void {
    this.receiveHandler = receive;
  }

  async close(): Promise<void> {
    for (const subId of this.subIds) {
      PubSub.instance.unsubscribe(subId);
    }
    this.subIds = [];
  }
}

class PubSub {
  static instance = new PubSub();

  private subIdIter = (function* subIdGen() {
    let i = 0;
    while (true) {
      i += 1;
      yield i;
    }
  })();
  private subscriptions: Record<string, { subId: number; handler: (message: unknown) => void }[]> = {};

  public publish(subject: string, message: RequestMessage<unknown> | ResponseMessage<unknown>): number {
    const subs = this.subscriptions[subject] ?? [];
    for (const sub of subs) {
      /**
       * This MessageTransport doesn't strictly require any marshalling or unmarshalling since the messages
       * are sent synchronously within the same process. However, we still annotate and deannotate the message,
       * effectively cloning it. The benefits are:
       * - It ensures that the original message is not mutated by the subscriber.
       * - It ensures compatibility with other transports.
       */
      const clonedMessage = deannotate(annotate(message));
      sub.handler(clonedMessage);
    }
    return subs.length;
  }

  public subscribe<T, R>(subject: string, callback: (message: RequestMessage<T> | ResponseMessage<R>) => void): number {
    const subs = this.subscriptions[subject] ?? [];
    const subId = this.subIdIter.next().value;
    subs.push({ subId, handler: callback as (message: unknown) => void });
    this.subscriptions[subject] = subs;
    return subId;
  }

  public unsubscribe(subId: number): void {
    for (const subject in this.subscriptions) {
      this.subscriptions[subject] = this.subscriptions[subject].filter(sub => sub.subId !== subId);
      if (this.subscriptions[subject].length === 0) {
        delete this.subscriptions[subject];
      }
    }
  }
}
