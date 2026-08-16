/**
 * dsh-loop-dock client bundle: a Settings → General "Default driver" row.
 *
 * Lists the drivers registered with the dock (via the `agentLoops/listDrivers`
 * Remote endpoint) and persists the choice to the `agent-loops` settings
 * namespace, which the dock reads when new sessions are created.
 */

window.__ModuleLoader__.load({
  id: "dsh-loop-dock",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let connection = require("@deepseek-ai/dsh-client-connection");

    const en = {
      title: "Default driver",
      description: "Loop engine new sessions are driven by. Existing sessions keep the driver they were created with.",
      loading: "Loading drivers…",
      error: "Could not load drivers.",
    };
    const zh = {
      title: "默认驱动",
      description: "新建会话使用的 loop 引擎。已有会话保持创建时的驱动不变。",
      loading: "正在加载驱动…",
      error: "无法加载驱动。",
    };

    const rowStyle = {
      borderBottom: "1px solid var(--dsw-alias-border-l2)",
      alignItems: "center",
      gap: "8px",
      padding: "16px 0",
      display: "flex",
    };
    const rowTextStyle = {
      flexDirection: "column",
      flex: 1,
      gap: "4px",
      minWidth: 0,
      display: "flex",
    };
    const titleStyle = {
      color: "var(--dsw-alias-label-primary)",
      fontSize: "14px",
      fontWeight: 400,
      lineHeight: "22px",
    };
    const descStyle = {
      color: "var(--dsw-alias-label-tertiary)",
      fontSize: "12px",
      lineHeight: "18px",
    };
    const selectStyle = {
      background: "var(--dsw-alias-bg-module-platform)",
      height: "36px",
      color: "var(--dsw-alias-label-primary)",
      cursor: "pointer",
      border: "none",
      borderRadius: "18px",
      padding: "0 14px",
      fontSize: "14px",
      lineHeight: "22px",
    };

    function DriverRow({ t, load, select }) {
      const [state, setState] = react.useState({
        status: "loading",
        drivers: [],
        current: "",
        error: null,
      });
      const refresh = react.useCallback(async () => {
        try {
          const result = await load();
          if (result.ok) {
            setState({
              status: "ready",
              drivers: Array.isArray(result.value?.drivers) ? result.value.drivers : [],
              current: typeof result.value?.current === "string" ? result.value.current : "",
              error: null,
            });
          } else {
            setState({ status: "error", drivers: [], current: "", error: result.error?.message ?? t("error") });
          }
        } catch (error) {
          setState({ status: "error", drivers: [], current: "", error: String(error?.message ?? error) });
        }
      }, [load, t]);
      react.useEffect(() => {
        refresh();
      }, [refresh]);
      const onSelect = async (id) => {
        if (id === state.current || id === "") return;
        setState((previous) => ({ ...previous, status: "saving" }));
        const result = await select(id);
        // `connection.rpc.call` already unwraps the transport frame to the
        // RpcResult; keep the extra unwrap as a defensive fallback.
        const inner = result?.result ?? result;
        if (inner?.ok === false) {
          setState((previous) => ({ ...previous, status: "ready", error: inner.error?.message ?? t("error") }));
          return;
        }
        await refresh();
      };
      return react.createElement(
        "div",
        { style: rowStyle },
        react.createElement(
          "div",
          { style: rowTextStyle },
          react.createElement("div", { style: titleStyle }, t("title")),
          react.createElement(
            "div",
            { style: descStyle },
            state.error ?? (state.status === "loading" ? t("loading") : t("description")),
          ),
        ),
        react.createElement(
          "select",
          {
            id: "agent-loops-default-driver",
            name: "agent-loops-default-driver",
            style: selectStyle,
            value: state.current,
            disabled: state.drivers.length === 0 || state.status === "loading" || state.status === "saving",
            onChange: (event) => onSelect(event.target.value),
          },
          state.drivers.map((driver) =>
            react.createElement("option", { key: driver, value: driver }, driver)),
        ),
      );
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register("settings.driver", { zh, en }), "dsh-loop-dock: settings row dictionaries");
      const injected = () => ({
        load: () => ctx.connection.rpc.call("/api", "agentLoops/listDrivers", { args: {} }),
        select: (id) => ctx.connection.rpc.call("/api", "agentLoops/setDefaultDriver", { args: { driver: id } }),
      });
      ctx.slots.inject("settings.general.item", () => ctx.slots.register({
        name: "settings.general.item",
        id: "agent-loops-driver",
        order: -20,
        locale: "settings.driver",
        inject: injected,
      }, DriverRow));
    }

    exports.apply = apply;
    // Cordis SERVICE names the row needs at apply time (not package ids —
    // the manifest-level package-id inject comes from package.json
    // `dsh.client.inject`; the bundle's own inject is service deps).
    exports.inject = ["slots", "locale", "connection"];
    return module.exports;
  },
});
