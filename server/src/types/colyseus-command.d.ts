declare module '@colyseus/command' {
  export abstract class Command<State, Payload> {
    state: State;
    room: unknown;
    abstract execute(payload: Payload): unknown;
  }
}
