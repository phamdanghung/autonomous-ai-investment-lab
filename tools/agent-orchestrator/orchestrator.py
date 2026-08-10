import os
import json
import time
import re
import sys
import subprocess
import asyncio
import logging
import pathlib
from datetime import datetime, timezone
from github import Github, GithubException

try:
    from google.antigravity import Agent, LocalAgentConfig
    from google.antigravity.types import CapabilitiesConfig, BuiltinTools
    import google.antigravity.hooks.policy as policy
    HAS_SDK = True
except ImportError:
    HAS_SDK = False

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

def get_state_path():
    env_path = os.environ.get("ORCHESTRATOR_STATE_PATH")
    if env_path:
        return env_path
    
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        local_app_data = os.path.expanduser("~/.config")
        
    return os.path.join(local_app_data, "AntigravityOrchestrator", "state.json")

def load_state():
    state_file = get_state_path()
    if os.path.exists(state_file):
        try:
            with open(state_file, "r") as f:
                return json.load(f)
        except Exception as e:
            logging.error(f"Failed to load state: {e}")
    return {}

def save_state(state):
    state_file = get_state_path()
    os.makedirs(os.path.dirname(state_file), exist_ok=True)
    tmp_file = state_file + ".tmp"
    with open(tmp_file, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp_file, state_file)

def update_cmd_state(state, cmd_id, status, **kwargs):
    if cmd_id not in state:
        state[cmd_id] = {}
    state[cmd_id]["status"] = status
    state[cmd_id]["timestamp"] = datetime.now(timezone.utc).isoformat()
    for k, v in kwargs.items():
        state[cmd_id][k] = v
    save_state(state)

def get_repo_path():
    repo_path = os.environ.get("GITHUB_REPOSITORY_PATH")
    if not repo_path:
        logging.error("GITHUB_REPOSITORY_PATH is required.")
        sys.exit(1)
    if not os.path.isabs(repo_path):
        logging.error("GITHUB_REPOSITORY_PATH must be an absolute path.")
        sys.exit(1)
    if not os.path.isdir(repo_path):
        logging.error(f"GITHUB_REPOSITORY_PATH does not exist: {repo_path}")
        sys.exit(1)
        
    try:
        inside = subprocess.check_output(['git', 'rev-parse', '--is-inside-work-tree'], cwd=repo_path, text=True, stderr=subprocess.STDOUT).strip()
        if inside != 'true':
            logging.error("Not inside a git work tree.")
            sys.exit(1)
            
        toplevel = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=repo_path, text=True, stderr=subprocess.STDOUT).strip()
        
        repo_norm = os.path.normcase(os.path.normpath(repo_path))
        toplevel_norm = os.path.normcase(os.path.normpath(toplevel))
        
        if repo_norm != toplevel_norm:
            logging.error(f"Repository path mismatch: {repo_norm} != {toplevel_norm}")
            sys.exit(1)
    except subprocess.CalledProcessError as e:
        logging.error(f"Git validation failed: {e.output}")
        sys.exit(1)
    except Exception as e:
        logging.error(f"Git validation error: {e}")
        sys.exit(1)
        
    return repo_path

def verify_remote_identity(repo_path, expected_repo):
    try:
        origin_url = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=repo_path, text=True, stderr=subprocess.STDOUT).strip()
        
        normalized = origin_url
        if normalized.endswith('.git'):
            normalized = normalized[:-4]
            
        if normalized.startswith('https://github.com/'):
            normalized = normalized[len('https://github.com/'):]
        elif normalized.startswith('git@github.com:'):
            normalized = normalized[len('git@github.com:'):]
            
        if normalized.lower() != expected_repo.lower():
            logging.error(f"REPOSITORY IDENTITY MISMATCH: {normalized} != {expected_repo}")
            sys.exit(1)
    except subprocess.CalledProcessError:
        logging.error("REPOSITORY IDENTITY MISMATCH: No origin remote found.")
        sys.exit(1)
    except Exception as e:
        logging.error(f"Error checking remote: {e}")
        sys.exit(1)

def _is_sensitive_args(args: dict) -> bool:
    if not isinstance(args, dict):
        return True # fail closed
    
    for val in args.values():
        if isinstance(val, str) and _is_sensitive_path(val):
            return True
            
    return False

def get_policies():
    # Apply to all known permutations of the localharness tools and BuiltinTools
    names = [
        "view_file",
        "list_dir", 
        "grep_search", 
        "find_file", 
        "find_by_name",
        "list_directory", 
        "search_directory"
    ]
    policies = [policy.deny(name, when=_is_sensitive_args) for name in names]
    policies.append(policy.allow("*"))
    return policies

def _get_arg(args, key):
    try:
        if not args or not getattr(args, "arguments_json", None):
            return None
        import json
        data = json.loads(args.arguments_json)
        return data.get(key)
    except Exception:
        return None

def _is_sensitive_path(path):
    if path is None:
        return True # fail closed
    if not isinstance(path, str):
        return True
    path = path.replace('\\', '/')
    parts = path.split('/')
    if '..' in parts:
        return True
        
    name = parts[-1].lower()
    if name == '.env' or name.startswith('.env.'): return True
    if name.endswith('.pem'): return True
    if name.endswith('.key'): return True
    
    for p in parts:
        p = p.lower()
        if p == 'credentials' or p.startswith('credentials.'): return True
        if p == 'secrets' or p.startswith('secrets.'): return True
        if 'token' in p: return True
        if 'private-key' in p or ('private' in p and 'key' in p): return True
        
    return False

async def run_agent(repo_path, cmd_id, instruction, is_dry_run):
    if not HAS_SDK:
        return False, "SDK not installed"
        
    config = LocalAgentConfig(
        capabilities=CapabilitiesConfig(
            enabled_tools=BuiltinTools.read_only()
        ),
        policies=get_policies(),
        workspaces=[repo_path]
    )
    
    try:
        async with Agent(config=config) as agent:
            response = await agent.chat(instruction)
            text = await response.text()
            return True, text
    except Exception as e:
        return False, f"Agent execution failed: {str(e)}"

def parse_command(body):
    match = re.search(r'\[AGENT_COMMAND\](.*?)\[/AGENT_COMMAND\]', body, re.DOTALL)
    if not match:
        return None
    content = match.group(1).strip()
    
    cmd = {}
    instruction_lines = []
    in_instruction = False
    
    for line in content.split('\n'):
        if in_instruction:
            instruction_lines.append(line)
            continue
            
        if line.startswith('instruction:'):
            in_instruction = True
            continue
            
        if ':' in line:
            key, val = line.split(':', 1)
            cmd[key.strip()] = val.strip()
            
    cmd['instruction'] = '\n'.join(instruction_lines).strip()
    return cmd

def validate_command(cmd, comment, config):
    if comment.user.id != int(config.get('allowed_github_user_id', 0)):
        return False, "Unauthorized GitHub author"
        
    if str(cmd.get('version')) != "1":
        return False, "Unsupported version"
        
    cmd_id = cmd.get('command_id', '')
    if not cmd_id or not re.match(r'^[a-zA-Z0-9_-]{1,64}$', cmd_id):
        return False, "Invalid command_id"
        
    if not cmd.get('task'):
        return False, "Missing task"
        
    if cmd.get('phase') != config.get('allowed_phase'):
        return False, "Unsupported phase"
        
    if cmd.get('repository') != config.get('repository'):
        return False, "Wrong repository"
        
    allowed_branch = config.get('allowed_branch')
    if not cmd.get('branch'):
        return False, "Missing branch"
    if cmd.get('branch') != allowed_branch:
        return False, "Wrong branch"
        
    expected_head = cmd.get('expected_head', '')
    if not expected_head or not re.match(r'^[a-fA-F0-9]{40}$', expected_head):
        return False, "Invalid expected_head"
        
    if cmd.get('scope') != config.get('allowed_scope'):
        return False, "Unsupported scope"
        
    if cmd.get('requested_by') != 'REVIEWER':
        return False, "Invalid requested_by"

    instruction = cmd.get('instruction', '').lower()
    if not instruction or len(instruction) > 10000:
        return False, "Invalid instruction length"
        
    destructive_keywords = [
        'modify file', 'edit file', 'rewrite file', 'change source', 'change code',
        'create file', 'delete file', 'remove file',
        'commit', 'push', 'checkout', 'reset', 'rebase', 'amend', 'squash', 
        'create branch', 'delete branch', 'create pr', 'open pr', 'merge pr',
        'database mutation', 'insert sql', 'update sql', 'delete sql',
        'drop', 'alter', 'migration', 'db reset', 'db push',
        'retrieve secret', 'extract secret', 'read secret', 'api key',
        'pat', 'token extraction', 'credential', 'cookie', 'private key',
        'rm -rf', 'alter table', 'insert into', 'update table', 'delete from'
    ]
    for kw in destructive_keywords:
        if kw in instruction:
            return False, "COMMAND EXCEEDS STAGE 1 READ_ONLY POLICY"

    return True, "Valid"

def check_baseline(cmd, repo_path):
    try:
        branch = subprocess.check_output(['git', 'branch', '--show-current'], text=True, cwd=repo_path).strip()
        head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True, cwd=repo_path).strip()
        status = subprocess.check_output(['git', 'status', '--short'], text=True, cwd=repo_path).strip()
        
        if branch != cmd.get('branch'):
            return False, f"Branch mismatch (expected {cmd.get('branch')}, got {branch})"
        if head != cmd.get('expected_head'):
            return False, f"HEAD mismatch (expected {cmd.get('expected_head')}, got {head})"
        
        if status:
            return False, "Working tree is dirty"
            
        return True, "Baseline OK"
    except Exception as e:
        return False, f"Git error: {e}"

def generate_report(cmd, status, report_content, actual_branch, actual_head, git_status):
    return f"""[AGENT_REPORT]
version: 1
command_id: {cmd.get('command_id', 'unknown')}
task: {cmd.get('task', 'unknown')}
phase: {cmd.get('phase', 'PLAN_ONLY')}
status: {status}
branch: {actual_branch}
head: {actual_head}
git_status: {git_status}

report:
{report_content}
[/AGENT_REPORT]"""

async def main_loop():
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        logging.error("GITHUB_TOKEN environment variable is required")
        sys.exit(1)

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    CONFIG_FILE = os.path.join(BASE_DIR, "config.example.json")
    with open(CONFIG_FILE, "r") as f:
        config = json.load(f)
        
    repo_name = os.environ.get("GITHUB_REPOSITORY", config.get("repository"))
    issue_num = int(os.environ.get("GITHUB_ISSUE_NUMBER", config.get("issue_number", 0)))
    allowed_user = int(os.environ.get("GITHUB_ALLOWED_USER_ID", config.get("allowed_github_user_id", 0)))
    allowed_branch = os.environ.get("GITHUB_ALLOWED_BRANCH", config.get("allowed_branch", ""))
    
    config['repository'] = repo_name
    config['issue_number'] = issue_num
    config['allowed_github_user_id'] = allowed_user
    config['allowed_branch'] = allowed_branch
    
    if not config.get('repository'):
        logging.error("Invalid config: repository is empty")
        sys.exit(1)
    if config.get('issue_number', 0) <= 0:
        logging.error("Invalid config: issue_number must be > 0")
        sys.exit(1)
    if config.get('allowed_github_user_id', 0) <= 0:
        logging.error("Invalid config: allowed_github_user_id must be > 0")
        sys.exit(1)
    if not config.get('allowed_branch'):
        logging.error("Invalid config: allowed_branch is empty")
        sys.exit(1)
    if config.get('poll_interval_seconds', 0) < 5:
        logging.error("Invalid config: poll_interval_seconds must be >= 5")
        sys.exit(1)
    if config.get('allowed_phase') != 'PLAN_ONLY':
        logging.error("Invalid config: allowed_phase must be PLAN_ONLY")
        sys.exit(1)
    if config.get('allowed_scope') != 'READ_ONLY':
        logging.error("Invalid config: allowed_scope must be READ_ONLY")
        sys.exit(1)
    
    dry_run = os.environ.get("ORCHESTRATOR_DRY_RUN", "false").lower() == "true"
    repo_path = get_repo_path()
    verify_remote_identity(repo_path, config['repository'])
    
    gh = Github(token)
    try:
        my_id = gh.get_user().id
        if my_id == config['allowed_github_user_id']:
            logging.error("Identity collision: orchestrator bot ID cannot equal allowed command author ID")
            sys.exit(1)
    except Exception as e:
        logging.error(f"Failed to get orchestrator identity: {e}")
        sys.exit(1)
        
    if my_id == allowed_user:
        logging.error("STAGE 1 BLOCKED — BOT AND COMMAND AUTHOR SHARE SAME GITHUB IDENTITY")
        sys.exit(1)

    try:
        repo = gh.get_repo(repo_name)
        issue = repo.get_issue(number=issue_num)
    except Exception as e:
        logging.error(f"Failed to access GitHub API for issue: {e}")
        sys.exit(1)

    logging.info(f"Connected to {repo_name}#({issue_num}) as ID: {my_id}")
    if dry_run:
        logging.info("DRY-RUN MODE ENABLED")

    while True:
        state = load_state()
        try:
            comments = list(issue.get_comments())
            
            for comment in comments:
                if comment.user.id == my_id:
                    continue
                
                if "[AGENT_REPORT]" in comment.body:
                    continue

                if "[AGENT_COMMAND]" in comment.body:
                    cmd = parse_command(comment.body)
                    if not cmd:
                        continue
                        
                    cmd_id = cmd.get('command_id')
                    if not cmd_id:
                        continue
                        
                    cmd_state = state.get(cmd_id, {}).get("status")
                    
                    if cmd_state in ["COMPLETED", "DRY_RUN_COMPLETED", "FAILED"]:
                        continue
                        
                    if not cmd_state:
                        if any(c == cmd_id for c in state):
                            continue 
                        
                        update_cmd_state(state, cmd_id, "DISCOVERED", comment_id=comment.id, task=cmd.get('task'), phase=cmd.get('phase'))
                        cmd_state = "DISCOVERED"
                        logging.info(f"Command ID {cmd_id} DISCOVERED")
                        
                    if cmd_state == "DISCOVERED":
                        is_valid, reason = validate_command(cmd, comment, config)
                        if not is_valid:
                            update_cmd_state(state, cmd_id, "FAILED", reason=reason)
                            logging.warning(f"Command {cmd_id} failed validation: {reason}")
                            continue
                            
                        baseline_ok, bl_reason = check_baseline(cmd, repo_path)
                        if not baseline_ok:
                            actual_branch = subprocess.check_output(['git', 'branch', '--show-current'], text=True, cwd=repo_path).strip()
                            actual_head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True, cwd=repo_path).strip()
                            actual_status = subprocess.check_output(['git', 'status', '--short'], text=True, cwd=repo_path).strip()
                            report_payload = generate_report(cmd, "BLOCKED", f"AGENT BLOCKED — BASELINE MISMATCH\n{bl_reason}", actual_branch, actual_head, actual_status)
                            
                            update_cmd_state(state, cmd_id, "REPORT_PENDING", report_payload=report_payload)
                            cmd_state = "REPORT_PENDING"
                            logging.warning(f"Command {cmd_id} failed baseline check.")
                        else:
                            update_cmd_state(state, cmd_id, "VALIDATED")
                            cmd_state = "VALIDATED"
                            logging.info(f"Command ID {cmd_id} VALIDATED")
                            
                    if cmd_state == "VALIDATED":
                        update_cmd_state(state, cmd_id, "RUNNING")
                        logging.info(f"Command ID {cmd_id} RUNNING")
                        
                        actual_branch = subprocess.check_output(['git', 'branch', '--show-current'], text=True, cwd=repo_path).strip()
                        actual_head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True, cwd=repo_path).strip()
                        actual_status = subprocess.check_output(['git', 'status', '--short'], text=True, cwd=repo_path).strip()
                        
                        if not dry_run:
                            success, report_content = await run_agent(repo_path, cmd_id, cmd.get('instruction'), dry_run)
                            report_payload = generate_report(cmd, "READY" if success else "FAILED", report_content, actual_branch, actual_head, actual_status)
                            update_cmd_state(state, cmd_id, "REPORT_PENDING", report_payload=report_payload)
                        else:
                            logging.info(f"[DRY-RUN] Would invoke Antigravity with instruction: {cmd.get('instruction')[:50]}...")
                            report_payload = generate_report(cmd, "READY", "[DRY-RUN] output", actual_branch, actual_head, actual_status)
                            update_cmd_state(state, cmd_id, "REPORT_PENDING", report_payload=report_payload)
                            
                        cmd_state = "REPORT_PENDING"

                    if cmd_state == "RUNNING":
                        logging.error(f"RECOVERY_BLOCKED — PRIOR EXECUTION OUTCOME UNKNOWN for cmd {cmd_id}")
                        update_cmd_state(state, cmd_id, "FAILED", reason="Crash during RUNNING")
                        continue

                    if cmd_state == "REPORT_PENDING":
                        already_posted = False
                        for c in comments:
                            if c.user.id == my_id and "[AGENT_REPORT]" in c.body and f"command_id: {cmd_id}\n" in c.body:
                                already_posted = True
                                break
                                
                        if already_posted:
                            update_cmd_state(state, cmd_id, "COMPLETED")
                            logging.info(f"Command ID {cmd_id} COMPLETED (matching bot report already found)")
                        else:
                            report_payload = state[cmd_id].get("report_payload", "")
                            if not dry_run:
                                try:
                                    issue.create_comment(report_payload)
                                    update_cmd_state(state, cmd_id, "COMPLETED")
                                    logging.info(f"Command ID {cmd_id} COMPLETED")
                                except Exception as e:
                                    logging.error(f"Failed to post report for {cmd_id}: {e}")
                            else:
                                logging.info(f"[DRY-RUN] Would post REPORT to GitHub:\n{report_payload}")
                                update_cmd_state(state, cmd_id, "DRY_RUN_COMPLETED")
                                
        except GithubException as e:
            logging.error(f"GitHub API Error: {e.status} {e.data}")
        except Exception as e:
            logging.error(f"Unexpected error during polling: {e}")
            
        if dry_run:
            break
            
        time.sleep(config.get("poll_interval_seconds", 30))

if __name__ == "__main__":
    asyncio.run(main_loop())
