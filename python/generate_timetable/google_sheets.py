"""Google Sheets API communication helpers."""

from google.oauth2 import service_account
from googleapiclient.discovery import build

from .config import SCOPES, SERVICE_ACCOUNT_FILE
from .colour_mapper import rgb_key
from .helpers import clean, dlog, dlog_error


def authenticate():
    """Build and return an authenticated Google Sheets API service."""
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    return build("sheets", "v4", credentials=creds)

def get_sheet_tab_names(service, spreadsheet_id):
    """Return the list of actual tab/sheet names in a spreadsheet."""
    try:
        meta = service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets.properties(title,index)"
        ).execute()
        return [s["properties"]["title"] for s in meta.get("sheets", [])]
    except Exception as e:
        dlog_error(f"Could not fetch tab names for {spreadsheet_id}: {e}")
        return []

def fetch_sheet_with_colours(service, spreadsheet_id, tab):
    """
    Fetch a full sheet tab using two lightweight API calls:

      1. spreadsheets.values.get()  — returns formatted cell text only.
         Very small response; never triggers the amplification-ratio limit.

      2. spreadsheets.get() with includeGridData=True BUT scoped to the
         exact bounding rectangle reported by call 1.  Because we request
         only the cells that actually contain data, the response stays well
         within Google's 100× amplification-ratio limit even for large sheets
         like the Business / FSM 'Timetable' tab.

    Returns:
        text_grid   — list of rows, each row a list of strings
        colour_grid — list of rows, each row a list of (R,G,B) tuples or None
    Both grids have the same dimensions.
    """
    dlog(f"Fetching spreadsheet={spreadsheet_id} tab='{tab}'")

    # ── Call 1: text only ────────────────────────────────────────────────────
    values_result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"'{tab}'",
        valueRenderOption="FORMATTED_VALUE",
    ).execute()

    raw_rows = values_result.get("values", [])
    if not raw_rows:
        return [], []

    num_rows = len(raw_rows)
    num_cols = max(len(r) for r in raw_rows)

    # Build a rectangular text grid from the values response
    text_grid = []
    for r in raw_rows:
        padded = [clean(v) for v in r] + [""] * (num_cols - len(r))
        text_grid.append(padded)

    # ── Call 2: colours only, bounded to actual data range ───────────────────
    # Convert column count to an A1-notation letter so the range is explicit.
    def col_to_letter(n):          # n is 1-based column count
        letters = ""
        while n:
            n, rem = divmod(n - 1, 26)
            letters = chr(65 + rem) + letters
        return letters

    end_col_letter = col_to_letter(num_cols)
    bounded_range  = f"'{tab}'!A1:{end_col_letter}{num_rows}"

    colour_result = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        ranges=[bounded_range],
        fields=(
            "sheets.data.rowData.values("
            "effectiveFormat.backgroundColor"
            ")"
        ),
        includeGridData=True,
    ).execute()

    sheets_data = colour_result.get("sheets", [])
    colour_rows = (
        sheets_data[0].get("data", [{}])[0].get("rowData", [])
        if sheets_data else []
    )

    # Build a rectangular colour grid aligned to text_grid dimensions
    colour_grid = []
    for r in range(num_rows):
        colour_row = []
        cells = colour_rows[r].get("values", []) if r < len(colour_rows) else []
        for c in range(num_cols):
            if c < len(cells):
                bg = cells[c].get("effectiveFormat", {}).get("backgroundColor")
                colour_row.append(rgb_key(bg))
            else:
                colour_row.append(None)
        colour_grid.append(colour_row)

    return text_grid, colour_grid
