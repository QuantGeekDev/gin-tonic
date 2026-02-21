const MAX_EVENTS = 200;
export class InMemoryPluginEventSink {
    events = [];
    emit(event) {
        this.events.push(event);
        if (this.events.length > MAX_EVENTS) {
            this.events.splice(0, this.events.length - MAX_EVENTS);
        }
    }
    list() {
        return [...this.events];
    }
    clear() {
        this.events.splice(0, this.events.length);
    }
}
//# sourceMappingURL=events.js.map