interface CompletionDeps {
  log: (line: string) => void;
}

function defaultDeps(): CompletionDeps {
  return {
    log: (line: string) => console.log(line),
  };
}

function printCompletionUsage(log: (line: string) => void): void {
  log("Completion commands:");
  log("  jihn completion bash");
  log("  jihn completion zsh");
  log("  jihn completion fish");
}

function bashScript(commandName: string): string {
  return `# bash completion for ${commandName}
_${commandName}_complete() {
  local cur prev words cword
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cword=\${COMP_CWORD}

  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "settings mcp plugin completion" -- "$cur") )
    return 0
  fi

  local first="\${COMP_WORDS[1]}"
  case "$first" in
    settings)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "list get set model keys help" -- "$cur") )
        return 0
      fi
      if [[ "$prev" == "--alias" ]]; then
        COMPREPLY=( $(compgen -W "default sonnet haiku" -- "$cur") )
        return 0
      fi
      if [[ "$prev" == "--key" ]]; then
        local keys
        keys="$(${commandName} settings keys 2>/dev/null)"
        COMPREPLY=( $(compgen -W "$keys" -- "$cur") )
        return 0
      fi
      COMPREPLY=( $(compgen -W "--key --value --alias --id" -- "$cur") )
      return 0
      ;;
    mcp)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "list tools add remove oauth help" -- "$cur") )
        return 0
      fi
      ;;
    plugin)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "list validate inspect enable disable create help" -- "$cur") )
        return 0
      fi
      ;;
    completion)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
        return 0
      fi
      ;;
  esac
}
complete -F _${commandName}_complete ${commandName}
`;
}

function zshScript(commandName: string): string {
  return `#compdef ${commandName}

_${commandName}_settings_keys() {
  local -a keys
  keys=("\${(@f)\$( ${commandName} settings keys 2>/dev/null )}")
  _describe 'setting keys' keys
}

_${commandName}() {
  local -a commands
  commands=(
    'settings:Manage runtime settings'
    'mcp:Manage MCP servers'
    'plugin:Manage workspace plugins'
    'completion:Print shell completion script'
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "$words[2]" in
    settings)
      _arguments \
        '2:subcommand:(list get set model keys help)' \
        '--key=[setting key]:key:_${commandName}_settings_keys' \
        '--value=[setting value]:value:' \
        '--alias=[model alias]:alias:(default sonnet haiku)' \
        '--id=[model id]:id:'
      ;;
    completion)
      _arguments '2:shell:(bash zsh fish)'
      ;;
    mcp)
      _arguments '2:subcommand:(list tools add remove oauth help)'
      ;;
    plugin)
      _arguments '2:subcommand:(list validate inspect enable disable create help)'
      ;;
  esac
}

compdef _${commandName} ${commandName}
`;
}

function fishScript(commandName: string): string {
  return `function __${commandName}_settings_keys
    ${commandName} settings keys 2>/dev/null
end

complete -c ${commandName} -f -n '__fish_use_subcommand' -a 'settings mcp plugin completion'
complete -c ${commandName} -f -n '__fish_seen_subcommand_from settings' -a 'list get set model keys help'
complete -c ${commandName} -f -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'
complete -c ${commandName} -f -n '__fish_seen_subcommand_from mcp' -a 'list tools add remove oauth help'
complete -c ${commandName} -f -n '__fish_seen_subcommand_from plugin' -a 'list validate inspect enable disable create help'
complete -c ${commandName} -f -n '__fish_seen_subcommand_from settings; and __fish_prev_arg_in --key' -a '(__${commandName}_settings_keys)'
complete -c ${commandName} -f -n '__fish_seen_subcommand_from settings; and __fish_prev_arg_in --alias' -a 'default sonnet haiku'
complete -c ${commandName} -f -n '__fish_seen_subcommand_from settings' -l key -d 'Setting key'
complete -c ${commandName} -f -n '__fish_seen_subcommand_from settings' -l value -d 'Setting value'
complete -c ${commandName} -f -n '__fish_seen_subcommand_from settings' -l alias -d 'Model alias'
complete -c ${commandName} -f -n '__fish_seen_subcommand_from settings' -l id -d 'Model id'
`;
}

export async function runCompletionCliCommand(
  args: string[],
  providedDeps?: Partial<CompletionDeps>,
): Promise<boolean> {
  if (args[0] !== "completion") {
    return false;
  }

  const deps: CompletionDeps = {
    ...defaultDeps(),
    ...providedDeps,
  };

  const shell = args[1] ?? "help";
  if (shell === "help" || shell === "--help" || shell === "-h") {
    printCompletionUsage(deps.log);
    return true;
  }

  const commandName = "jihn";
  if (shell === "bash") {
    deps.log(bashScript(commandName));
    return true;
  }
  if (shell === "zsh") {
    deps.log(zshScript(commandName));
    return true;
  }
  if (shell === "fish") {
    deps.log(fishScript(commandName));
    return true;
  }

  printCompletionUsage(deps.log);
  return true;
}
