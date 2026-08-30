var __dsPreview = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // <define:import.meta.env>
  var init_define_import_meta_env = __esm({
    "<define:import.meta.env>"() {
    }
  });

  // ds-raw:__ds_raw__
  var require_ds_raw = __commonJS({
    "ds-raw:__ds_raw__"(exports, module) {
      init_define_import_meta_env();
      module.exports = window.PrismDS;
    }
  });

  // shim:react-shim
  var require_react_shim = __commonJS({
    "shim:react-shim"(exports, module) {
      init_define_import_meta_env();
      var R = window.React;
      function np(p, k) {
        var o = {};
        for (var x in p) if (x !== "children") o[x] = p[x];
        if (k !== void 0) o.key = k;
        return o;
      }
      function jsx2(t, p, k) {
        var c = p && p.children;
        return c === void 0 ? R.createElement(t, np(p, k)) : R.createElement(t, np(p, k), c);
      }
      function jsxs2(t, p, k) {
        return R.createElement.apply(R, [t, np(p, k)].concat(p.children));
      }
      module.exports = R;
      module.exports.jsx = jsx2;
      module.exports.jsxs = jsxs2;
      module.exports.jsxDEV = function(t, p, k, s) {
        return (s ? jsxs2 : jsx2)(t, p, k);
      };
      module.exports.Fragment = R.Fragment;
    }
  });

  // .design-sync/previews/Field.tsx
  var Field_exports = {};
  __export(Field_exports, {
    HorizontalAndSeparated: () => HorizontalAndSeparated,
    Invalid: () => Invalid,
    StudyDetails: () => StudyDetails
  });
  init_define_import_meta_env();

  // ds-shim:ds
  var ds_exports = {};
  __export(ds_exports, {
    default: () => ds_default
  });
  init_define_import_meta_env();
  __reExport(ds_exports, __toESM(require_ds_raw()));
  var g = window.PrismDS;
  var ds_default = "default" in g ? g.default : g;

  // .design-sync/previews/Field.tsx
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  function Frame({ children }) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { "data-theme": "light", className: "bg-background text-foreground rounded-lg p-6", children });
  }
  function StudyDetails() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Frame, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ds_exports.FieldSet, { className: "w-full max-w-md", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldLegend, { children: "Study details" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ds_exports.FieldGroup, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ds_exports.Field, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldLabel, { htmlFor: "f-name", children: "Study name" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.Input, { id: "f-name", defaultValue: "Cotton tote bag" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldDescription, { children: "Shown in the workspace header and on exports." })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ds_exports.Field, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldLabel, { htmlFor: "f-unit", children: "Functional unit" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.Input, { id: "f-unit", defaultValue: "1 unit" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldDescription, { children: "The reference amount every result is scaled to." })
        ] })
      ] })
    ] }) });
  }
  function HorizontalAndSeparated() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Frame, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ds_exports.FieldGroup, { className: "w-full max-w-md", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ds_exports.Field, { orientation: "horizontal", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.Checkbox, { id: "f-decimals", defaultChecked: true }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ds_exports.FieldContent, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldTitle, { children: "Show all decimal places" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldDescription, { children: "Applied to numerical results across the workspace." })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldSeparator, {}),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ds_exports.Field, { orientation: "horizontal", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.Checkbox, { id: "f-reference" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ds_exports.FieldContent, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldTitle, { children: "Show reference amounts" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldDescription, { children: "Annotate each edge with its scaled flow amount." })
        ] })
      ] })
    ] }) });
  }
  function Invalid() {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Frame, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ds_exports.Field, { className: "w-full max-w-md", "data-invalid": "true", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldLabel, { htmlFor: "f-threshold", children: "Contribution threshold" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.Input, { id: "f-threshold", defaultValue: "-4", "aria-invalid": true }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ds_exports.FieldError, { children: "Threshold must be between 0 and 100 percent." })
    ] }) });
  }
  return __toCommonJS(Field_exports);
})();
